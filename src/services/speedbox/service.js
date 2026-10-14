'use strict';
const { Op } = require('sequelize');
const { z } = require('zod');
const { sequelize, Tienda, Envio, EnvioItem, EnvioItemComponente, Producto, ProductoVariante,
  Deposito, SpeedboxTienda, SpeedboxPedido, SpeedboxEvento, SolicitudAbastecimiento } = require('../../models');
const client = require('./client');
const { buildOrder, buildSupplyOrder } = require('./payload');

function environment() { return process.env.SPEEDBOX_ENVIRONMENT || 'sandbox'; }
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function extractCredentialInput(input = {}) {
  const rawApiKey = input.api_key ?? input.public_key ?? input.apiKey;
  const rawSecret = input.api_secret ?? input.private_key ?? input.secret;
  return {
    provided: rawApiKey !== undefined || rawSecret !== undefined,
    apiKey: rawApiKey === undefined || rawApiKey === null ? '' : String(rawApiKey).trim(),
    secret: rawSecret === undefined || rawSecret === null ? '' : String(rawSecret).trim(),
  };
}
function credentialsConfigured(connection) {
  return Boolean(connection?.public_key && connection?.private_key);
}
function credentialsFor(connection, input = {}, { fallbackEnvironment = environment(), allowInput = true } = {}) {
  const candidate = extractCredentialInput(input);
  const apiKey = allowInput && candidate.apiKey ? candidate.apiKey : String(connection?.public_key || '').trim();
  const secret = allowInput && candidate.secret ? candidate.secret : String(connection?.private_key || '').trim();
  if (!apiKey || !secret) fail('Cargá y guardá la public key y la private key de RAHA para usar esta integración.', 400);
  if (apiKey.length > 255 || secret.length > 512) fail('Las credenciales RAHA tienen un formato inválido.', 400);
  return { environment: connection?.environment || fallbackEnvironment, apiKey, secret };
}
function credentialUpdates(input = {}, connection = null) {
  const candidate = extractCredentialInput(input);
  const updates = {};
  if (input.api_key !== undefined || input.public_key !== undefined || input.apiKey !== undefined) {
    if (candidate.apiKey.length > 255) fail('La public key de RAHA es demasiado larga.');
    updates.public_key = candidate.apiKey || null;
  }
  if (input.api_secret !== undefined || input.private_key !== undefined || input.secret !== undefined) {
    if (candidate.secret.length > 512) fail('La private key de RAHA es demasiado larga.');
    if (candidate.secret) updates.private_key = candidate.secret;
  }
  const finalPublic = updates.public_key !== undefined ? updates.public_key : connection?.public_key;
  const finalPrivate = updates.private_key !== undefined ? updates.private_key : connection?.private_key;
  return { updates, finalPublic: String(finalPublic || '').trim(), finalPrivate: String(finalPrivate || '').trim() };
}
function serializeConnection(connection) {
  if (!connection) return null;
  const plain = typeof connection.toJSON === 'function' ? connection.toJSON() : { ...connection };
  delete plain.private_key;
  plain.has_private_key = credentialsConfigured(connection);
  return plain;
}
function esProductoExterno(producto, usuarioId) {
  return usuarioId != null && Number(producto?.creado_por) !== Number(usuarioId);
}

function componenteSaleDeStockLocal(component) {
  return Boolean(component?.origen_centro_id && (parseInt(component.cantidad_desde_centro, 10) || 0) > 0);
}

async function envioTieneProductosExternos(envioId, usuarioId, transaction) {
  const componentes = await EnvioItemComponente.findAll({
    attributes: ['id', 'origen_centro_id', 'cantidad_desde_centro'],
    include: [
      { model: EnvioItem, where: { envio_id: envioId }, attributes: [], required: true },
      { model: Producto, as: 'producto', attributes: ['id', 'creado_por'], required: true },
    ],
    transaction,
  });
  return componentes.some(component => esProductoExterno(component.producto, usuarioId) && !componenteSaleDeStockLocal(component));
}

function registrationUrl() {
  try {
    const raw = process.env.SPEEDBOX_REGISTRATION_URL;
    if (!raw || raw.length > 2048) return null;
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password ||
        [...url.searchParams.keys()].some(key => /secret|token|authorization|api.?key/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}

function productionRequestUrl() {
  return 'https://speedboxpy.com/speedbox_api_cliente.php';
}

function webhookUrl({ publicBaseUrl = null, targetEnvironment = environment() } = {}) {
  const token = process.env.SPEEDBOX_WEBHOOK_TOKEN;
  const rawBase = process.env.SPEEDBOX_WEBHOOK_PUBLIC_BASE_URL || process.env.API_PUBLIC_URL ||
    process.env.BACKEND_PUBLIC_URL || process.env.PUBLIC_API_URL || publicBaseUrl || process.env.FRONTEND_URL;
  if (!rawBase) return null;
  try {
    const url = new URL('/api/webhooks/speedbox', rawBase);
    if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') return null;
    url.searchParams.set('environment', targetEnvironment || environment());
    if (token && token.length >= 32) url.searchParams.set('token', token);
    return url.href;
  } catch { return null; }
}

async function dispatchConfirmedOrder(usuarioId, envioId) {
  if (process.env.SPEEDBOX_ENABLED !== 'true') return;
  try {
    const queued = await SpeedboxPedido.findOne({ where: { usuario_id: usuarioId, envio_id: envioId, environment: environment(), estado: 'pendiente' } });
    if (queued) await sendOrder(usuarioId, envioId);
  } catch (error) {
    require('../../utils/logger').logger.warn({ evento: 'SPEEDBOX_CONFIRMATION_DISPATCH_FAILED', envioId,
      message: client.redact(error.message) });
  }
}

async function dispatchSupplyRequest(usuarioId, solicitudId) {
  try {
    const queued = await SpeedboxPedido.findOne({ where: { usuario_id: usuarioId, solicitud_abastecimiento_id: solicitudId, environment: environment(), estado: 'pendiente' } });
    if (queued) await sendSupplyRequest(usuarioId, solicitudId);
  } catch (error) {
    require('../../utils/logger').logger.warn({ evento: 'SPEEDBOX_SUPPLY_DISPATCH_FAILED', solicitudId,
      message: client.redact(error.message) });
  }
}

async function queueConfirmedOrder(envio, transaction) {
  if (process.env.SPEEDBOX_ENABLED !== 'true' || envio.estado !== 'Confirmado' || !envio.stock_descontado || envio.stock_liberado) return null;
  const connection = await SpeedboxTienda.findOne({ where: { usuario_id: envio.usuario_id, environment: environment(), activo: true }, transaction });
  if (!connection?.tienda_id) return null;
  const pedidoRaha = await envioTieneProductosExternos(envio.id, envio.usuario_id, transaction);
  if (!pedidoRaha) return null;
  const [mapping] = await SpeedboxPedido.findOrCreate({ where: { environment: environment(), envio_id: envio.id },
    defaults: { usuario_id: envio.usuario_id, external_order_id: `GESICOMM-${environment()}-${envio.usuario_id}-${envio.id}` }, transaction });
  if (mapping.estado === 'pendiente') {
    // Commit the outbox with confirmation; never send an uncommitted order.
    transaction.afterCommit(() => { setImmediate(() => { void dispatchConfirmedOrder(envio.usuario_id, envio.id); }); });
  }
  return mapping;
}

async function queueSupplyRequest(solicitud, transaction) {
  if (solicitud.tipo_logistica !== 'PROPIA') return null;
  const connection = await SpeedboxTienda.findOne({ where: { usuario_id: solicitud.usuario_id, environment: environment() }, transaction });
  if (!connection?.tienda_id) fail('RAHA no está vinculado para esta tienda.', 409);
  credentialsFor(connection, {}, { allowInput: false });
  const [mapping] = await SpeedboxPedido.findOrCreate({
    where: { environment: environment(), solicitud_abastecimiento_id: solicitud.id },
    defaults: {
      usuario_id: solicitud.usuario_id,
      envio_id: null,
      external_order_id: `GESICOMM-ABAST-${environment()}-${solicitud.usuario_id}-${solicitud.id}`,
    },
    transaction,
  });
  if (mapping.estado === 'pendiente') {
    transaction.afterCommit(() => { setImmediate(() => { void dispatchSupplyRequest(solicitud.usuario_id, solicitud.id); }); });
  }
  return mapping;
}

async function connectionFor(usuarioId, options = {}) {
  const { environment: targetEnvironment = environment(), ...queryOptions } = options;
  const connection = await SpeedboxTienda.findOne({ where: { usuario_id: usuarioId, environment: targetEnvironment }, ...queryOptions });
  if (!connection) fail('Vinculá primero tu tienda con RAHA.', 409);
  return connection;
}

async function status(usuarioId, options = {}) {
  const connection = await SpeedboxTienda.findOne({ where: { usuario_id: usuarioId, environment: environment() } });
  const orders = await SpeedboxPedido.findAll({ where: { usuario_id: usuarioId, environment: environment() },
    attributes: ['id', 'envio_id', 'external_order_id', 'order_id', 'estado', 'status', 'intentos', 'error', 'updated_at'],
    include: [{ model: Envio, as: 'envio', attributes: ['numero_pedido', 'monto', 'costo_envio', 'costo_fulfillment',
      'delivery_a_cargo', 'pago_anticipado', 'abastecimiento_estado', 'abastecimiento_costo', 'abastecimiento_pagado_at', 'estado_financiero'] }], order: [['updated_at', 'DESC']], limit: 50 });
  const events = await SpeedboxEvento.findAll({ where: { usuario_id: usuarioId, environment: environment() },
    attributes: ['id', 'event_key', 'tipo', 'order_id', 'occurred_at', 'estado', 'detalle', 'payload', 'source', 'conciliacion'], order: [['id', 'DESC']], limit: 50 });
  const orderVerified = await SpeedboxPedido.count({ where: { usuario_id: usuarioId, environment: environment(), order_id: { [Op.ne]: null } } });
  const solicitudes = await SolicitudAbastecimiento.findAll({ where: { usuario_id: usuarioId },
    attributes: ['id', 'costo_producto', 'costo_logistico', 'estado'], order: [['id', 'DESC']], limit: 100 });
  const [availableOrders] = await sequelize.query(`
    SELECT e.id, e.numero_pedido, e.cliente FROM envios e
    LEFT JOIN speedbox_pedidos p ON p.envio_id = e.id AND p.environment = :environment
    WHERE e.usuario_id = :usuario
      AND EXISTS (
        SELECT 1 FROM envio_items i
        JOIN envio_item_componentes c ON c.envio_item_id = i.id
        JOIN productos pr ON pr.id = c.producto_id
        WHERE i.envio_id = e.id AND pr.creado_por IS DISTINCT FROM e.usuario_id
      )
      AND p.id IS NULL
      AND e.estado IN ('Confirmado', 'Preparado', 'Despachado', 'Reprogramado')
      AND e.stock_descontado = TRUE AND e.stock_liberado = FALSE
    ORDER BY e.id DESC LIMIT 50`, { replacements: { usuario: usuarioId, environment: environment() } });
  const credentials = credentialsConfigured(connection);
  const sandboxWebhook = webhookUrl({ ...options, targetEnvironment: 'sandbox' });
  const productionWebhook = webhookUrl({ ...options, targetEnvironment: 'production' });
  const webhook = webhookUrl(options);
  return { environment: environment(), credentials_configured: credentials,
    sandbox_endpoint: 'https://speedboxpy.com/api/speedbox_sandbox.php',
    registration_url: registrationUrl(),
    production_request_url: productionRequestUrl(),
    webhook_url: productionWebhook || webhook,
    production_webhook_url: productionWebhook,
    sandbox_webhook_url: sandboxWebhook,
    automatic_enabled: process.env.SPEEDBOX_ENABLED === 'true',
    webhook_configured: Boolean(webhook),
    public_key: connection?.public_key || '',
    has_private_key: Boolean(connection?.private_key),
    connection: serializeConnection(connection),
    orders: orders.map(order => ({ ...order.toJSON(), finanzas: order.envio ? require('./finanzas').desglose(order.envio) : null })),
    events, solicitudes_abastecimiento: solicitudes, available_orders: availableOrders,
    checks: { spec: Boolean(connection?.spec_verified_at), order: Boolean(connection?.order_verified_at) || orderVerified > 0,
      updates: Boolean(connection?.updates_verified_at), webhook: Boolean(connection?.webhook_verified_at) } };
}

const configSchema = z.object({
  courier_id: z.number().int().positive().nullable().optional(),
  activo: z.boolean(),
  public_key: z.string().trim().max(255).nullable().optional(),
  private_key: z.string().trim().max(512).nullable().optional(),
  api_key: z.string().trim().max(255).nullable().optional(),
  api_secret: z.string().trim().max(512).nullable().optional(),
  apiKey: z.string().trim().max(255).nullable().optional(),
  secret: z.string().trim().max(512).nullable().optional(),
}).strict();
async function configure(usuarioId, input) {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) fail('Configuración RAHA inválida.');
  const { activo } = parsed.data;
  return sequelize.transaction(async transaction => {
    const [connection] = await SpeedboxTienda.findOrCreate({
      where: { usuario_id: usuarioId, environment: environment() },
      defaults: { since_at: new Date().toISOString() },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const credentialState = credentialUpdates(parsed.data, connection);
    if (activo && (!credentialState.finalPublic || !credentialState.finalPrivate)) {
      fail('Guardá la public key y la private key de RAHA antes de activar la integración.', 409);
    }
    if (activo && !connection.tienda_id) fail('Vinculá primero tu tienda RAHA.', 409);
    return connection.update({ courier_id: null, activo, ...credentialState.updates,
      enabled_at: activo && !connection.activo ? new Date() : connection.enabled_at,
      since_at: connection.since_at || new Date().toISOString() }, { transaction });
  });
}

async function registerStore(usuarioId, input = {}) {
  const credentialInput = extractCredentialInput(input);
  const env = credentialInput.provided ? 'sandbox' : environment();
  const tienda = await Tienda.findOne({ where: { usuario_id: usuarioId } });
  if (!tienda) fail('Primero configura tu tienda.', 404);
  return sequelize.transaction(async transaction => {
    await sequelize.query('SELECT pg_advisory_xact_lock(84271004, :usuario)', { replacements: { usuario: Number(usuarioId) }, transaction });
    const [connection] = await SpeedboxTienda.findOrCreate({ where: { usuario_id: usuarioId, environment: env }, defaults: { since_at: new Date().toISOString() }, transaction });
    const credentials = credentialsFor(connection, input, { fallbackEnvironment: env });
    const updates = credentialUpdates(input, connection).updates;
    if (Object.keys(updates).length) await connection.update(updates, { transaction });
    if (connection.tienda_id) return connection;
    const response = await client.request('store', { method: 'POST', credentials, body: {
      external_store_id: `GESICOMM-${env}-${usuarioId}`, store_name: tienda.nombre,
      domain: tienda.dominio_propio_verificado && tienda.dominio_propio_habilitado && tienda.dominio_propio
        ? tienda.dominio_propio : `${tienda.subdominio}.${process.env.TIENDA_DOMINIO_BASE || 'gesicomm.com'}`,
      currency: 'PYG', country: 'PY', timezone: 'America/Asuncion',
    } });
    let tiendaId;
    try { tiendaId = client.remoteId(response.tienda_id ?? response.store?.tienda_id ?? response.tienda?.tienda_id); }
    catch (error) { error.remoteResponse = client.redact(response); throw error; }
    return connection.update({ tienda_id: tiendaId }, { transaction });
  });
}

async function verifySpec(usuarioId, input = {}) {
  const tienda = await Tienda.findOne({ where: { usuario_id: usuarioId } });
  if (!tienda) fail('Primero configura tu tienda.', 404);
  const credentialInput = extractCredentialInput(input);
  const env = credentialInput.provided ? 'sandbox' : environment();
  const [connection] = await SpeedboxTienda.findOrCreate({ where: { usuario_id: usuarioId, environment: env }, defaults: { since_at: new Date().toISOString() } });
  const credentials = credentialsFor(connection, input, { fallbackEnvironment: env });
  await client.request('spec', { credentials });
  const updates = { spec_verified_at: new Date(), ...credentialUpdates(input, connection).updates };
  await connection.update(updates);
  return { ok: true };
}

async function verifyOrder(usuarioId, input = {}) {
  const credentialInput = extractCredentialInput(input);
  const env = credentialInput.provided ? 'sandbox' : environment();
  const tienda = await Tienda.findOne({ where: { usuario_id: usuarioId } });
  if (!tienda) fail('Primero configura tu tienda.', 404);
  const connection = await connectionFor(usuarioId, { environment: env });
  const credentials = credentialsFor(connection, input, { fallbackEnvironment: env });
  if (!connection.tienda_id) fail('Primero vinculá la tienda sandbox de RAHA.', 409);
  const now = new Date();
  const externalId = `GESICOMM-TEST-${credentials.environment}-${usuarioId}-${now.getTime()}`;
  const payload = {
    external_order_id: externalId,
    order_name: `#TEST-${now.getTime()}`,
    tienda_id: String(connection.tienda_id),
    created_at: now.toISOString(),
    currency: 'PYG',
    total_price: 85000,
    financial_status: 'pending',
    payment_method: 'contra_entrega',
    store_name: tienda.nombre,
    customer: { name: 'Cliente sandbox Gesicom', phone: tienda.whatsapp || '0981000000' },
    shipping_address: {
      address: tienda.direccion_publica || tienda.deposito_direccion || 'Av. Mariscal Lopez 1234',
      reference: 'Pedido de validacion sandbox',
      city: tienda.ciudad_publica || tienda.deposito_ciudad || 'Asuncion',
      department: tienda.deposito_departamento || 'Central',
      google_maps_url: '',
    },
    billing_document_type: 'CI',
    billing_document_number: '1234567',
    items: [{ sku: 'GESICOM-TEST-001', title: 'Producto sandbox Gesicom', quantity: 1, price: 85000 }],
  };
  const response = await client.request('order', { method: 'POST', credentials, body: payload });
  const orderId = client.remoteId(response.order?.order_id);
  if (response.order?.external_order_id !== externalId) fail('RAHA respondió un pedido distinto al enviado.', 502);
  await connection.update({ order_verified_at: new Date(), ...credentialUpdates(input, connection).updates });
  return { ok: true, order_id: orderId, status: response.order?.status || null };
}

async function verifyUpdates(usuarioId, input = {}) {
  const credentialInput = extractCredentialInput(input);
  const env = credentialInput.provided ? 'sandbox' : environment();
  const connection = await connectionFor(usuarioId, { environment: env });
  const credentials = credentialsFor(connection, input, { fallbackEnvironment: env });
  if (!connection.tienda_id) fail('Primero vinculá la tienda sandbox de RAHA.', 409);
  const sinceAt = connection.since_at || new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const response = await client.request('updates', { credentials, sinceAt });
  if (!Array.isArray(response.events) || typeof response.next_since_at !== 'string' || !Number.isFinite(Date.parse(response.next_since_at))) {
    fail('RAHA devolvió una respuesta de updates inválida.', 502);
  }
  for (const inputEvent of response.events) await require('./events').ingest(inputEvent, 'updates');
  await connection.update({ since_at: response.next_since_at, updates_verified_at: new Date(), ...credentialUpdates(input, connection).updates });
  return { ok: true, events: response.events.length, next_since_at: response.next_since_at };
}

async function sendOrder(usuarioId, envioId, { retry = false, acknowledgeUncertain = false } = {}) {
  const claimed = await sequelize.transaction(async transaction => {
    const connection = await connectionFor(usuarioId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!connection.activo || !connection.tienda_id) fail('RAHA no está activo para esta tienda.', 409);
    const envio = await Envio.findOne({ where: { id: envioId, usuario_id: usuarioId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!envio) fail('Pedido no encontrado.', 404);
    const pedidoRaha = await envioTieneProductosExternos(envio.id, usuarioId, transaction);
    const [mapping] = await SpeedboxPedido.findOrCreate({ where: { environment: environment(), envio_id: envio.id },
      defaults: { usuario_id: usuarioId, external_order_id: `GESICOMM-${environment()}-${usuarioId}-${envio.id}` }, transaction });
    if (mapping.order_id) return { mapping, sent: true };
    const credentials = credentialsFor(connection, {}, { allowInput: false });
    if (mapping.estado === 'enviando' && Date.now() - new Date(mapping.updated_at).getTime() < 120000) fail('El envio sigue en curso. Espera antes de conciliar o reintentar.', 409);
    if (mapping.estado !== 'pendiente' && !retry) fail('El pedido requiere un reintento manual.', 409);
    if (['enviando', 'incierto'].includes(mapping.estado) && !acknowledgeUncertain) fail('Verificá en RAHA si el pedido ya existe antes de autorizar el reintento.', 409);
    if (!['Confirmado', 'Preparado', 'Despachado', 'Reprogramado'].includes(envio.estado) || !envio.stock_descontado || envio.stock_liberado) fail('El pedido debe estar confirmado y con stock reservado.', 409);
    if (!pedidoRaha) fail('Este pedido no contiene productos RAHA para enviar a RAHA.', 409);
    // An uncertain submission always retains its original payload and external ID.
    let payload = mapping.request_payload;
    if (!payload || mapping.estado === 'error') {
      const tienda = await Tienda.findOne({ where: { usuario_id: usuarioId }, transaction });
      if (!tienda) fail('Tienda no encontrada.', 404);
      envio.items = await EnvioItem.findAll({ where: { envio_id: envio.id }, transaction, order: [['id', 'ASC']], include: [
        { model: EnvioItemComponente, as: 'componentes_vendidos', include: [{ model: Producto, as: 'producto', attributes: ['id', 'sku', 'nombre', 'creado_por'] }] },
      ] });
      const ids = envio.items.flatMap(item => item.componentes_vendidos.map(component => component.variante_id)).filter(Boolean);
      const variants = ids.length ? await ProductoVariante.findAll({ where: { id: { [Op.in]: ids } }, transaction }) : [];
      try {
        payload = buildOrder(envio, tienda, connection, new Map(variants.map(variant => [variant.id, variant])), {
          onlyExternalProducts: pedidoRaha,
          usuarioId,
        });
      }
      catch (error) {
        await mapping.update({ estado: 'error', error: error.message }, { transaction });
        return { mapping, validationError: error };
      }
    }
    await mapping.update({ estado: 'enviando', request_payload: payload, error: null, intentos: mapping.intentos + 1 }, { transaction });
    return { mapping, credentials };
  });
  if (claimed.validationError) throw claimed.validationError;
  if (claimed.sent) return claimed.mapping;
  const mapping = claimed.mapping;
  let response;
  try {
    response = await client.request('order', { method: 'POST', credentials: claimed.credentials, body: mapping.request_payload });
    const order = response.order;
    const orderId = client.remoteId(order?.order_id);
    if (order?.external_order_id !== mapping.external_order_id) throw Object.assign(new Error('La respuesta no corresponde al pedido enviado.'), { uncertain: true });
    await mapping.update({ estado: 'enviado', order_id: orderId, status: order.status || 'pendiente_confirmacion',
      response_payload: client.redact(response), remote_http_status: 201, error: null });
  } catch (error) {
    await mapping.update({ estado: error.uncertain || response ? 'incierto' : 'error', error: client.redact(error.message),
      response_payload: client.redact(response || error.remoteResponse || null), remote_http_status: error.remoteStatus || null });
    throw error;
  }
  return mapping;
}

async function sendSupplyRequest(usuarioId, solicitudId, { retry = false, acknowledgeUncertain = false } = {}) {
  const claimed = await sequelize.transaction(async transaction => {
    const connection = await connectionFor(usuarioId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!connection.tienda_id) fail('RAHA no está vinculado para esta tienda.', 409);
    const solicitud = await SolicitudAbastecimiento.findOne({ where: { id: solicitudId, usuario_id: usuarioId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!solicitud) fail('Solicitud de abastecimiento no encontrada.', 404);
    if (solicitud.tipo_logistica !== 'PROPIA' || !solicitud.deposito_destino_id) {
      fail('El pedido RAHA de abastecimiento necesita un depósito propio de destino.', 409);
    }
    const [mapping] = await SpeedboxPedido.findOrCreate({
      where: { environment: environment(), solicitud_abastecimiento_id: solicitud.id },
      defaults: {
        usuario_id: usuarioId,
        envio_id: null,
        external_order_id: `GESICOMM-ABAST-${environment()}-${usuarioId}-${solicitud.id}`,
      },
      transaction,
    });
    if (mapping.order_id) return { mapping, sent: true };
    const credentials = credentialsFor(connection, {}, { allowInput: false });
    if (mapping.estado === 'enviando' && Date.now() - new Date(mapping.updated_at).getTime() < 120000) fail('El envio sigue en curso. Espera antes de conciliar o reintentar.', 409);
    if (mapping.estado !== 'pendiente' && !retry) fail('El pedido requiere un reintento manual.', 409);
    if (['enviando', 'incierto'].includes(mapping.estado) && !acknowledgeUncertain) fail('Verificá en RAHA si el pedido ya existe antes de autorizar el reintento.', 409);
    let payload = mapping.request_payload;
    if (!payload || mapping.estado === 'error') {
      const [tienda, producto, deposito] = await Promise.all([
        Tienda.findOne({ where: { usuario_id: usuarioId }, transaction }),
        Producto.findByPk(solicitud.producto_id, { transaction }),
        Deposito.findOne({ where: { id: solicitud.deposito_destino_id, usuario_id: usuarioId }, transaction }),
      ]);
      if (!tienda) fail('Tienda no encontrada.', 404);
      if (!producto) fail('Producto no encontrado.', 404);
      if (!deposito) fail('Depósito de destino no encontrado.', 404);
      const variante = solicitud.variante_id
        ? await ProductoVariante.findOne({ where: { id: solicitud.variante_id, producto_id: solicitud.producto_id }, transaction })
        : null;
      try {
        payload = buildSupplyOrder(solicitud, tienda, connection, { producto, variante, deposito });
      } catch (error) {
        await mapping.update({ estado: 'error', error: error.message }, { transaction });
        return { mapping, validationError: error };
      }
    }
    await mapping.update({ estado: 'enviando', request_payload: payload, error: null, intentos: mapping.intentos + 1 }, { transaction });
    return { mapping, credentials };
  });
  if (claimed.validationError) throw claimed.validationError;
  if (claimed.sent) return claimed.mapping;
  const mapping = claimed.mapping;
  let response;
  try {
    response = await client.request('order', { method: 'POST', credentials: claimed.credentials, body: mapping.request_payload });
    const order = response.order;
    const orderId = client.remoteId(order?.order_id);
    if (order?.external_order_id !== mapping.external_order_id) throw Object.assign(new Error('La respuesta no corresponde al abastecimiento enviado.'), { uncertain: true });
    await mapping.update({ estado: 'enviado', order_id: orderId, status: order.status || 'pendiente_confirmacion',
      response_payload: client.redact(response), remote_http_status: 201, error: null });
  } catch (error) {
    await mapping.update({ estado: error.uncertain || response ? 'incierto' : 'error', error: client.redact(error.message),
      response_payload: client.redact(response || error.remoteResponse || null), remote_http_status: error.remoteStatus || null });
    throw error;
  }
  return mapping;
}

async function runCycle() {
  if (process.env.SPEEDBOX_ENABLED !== 'true') return;
  const [candidates] = await sequelize.query(`
    SELECT e.id, e.usuario_id FROM envios e
    JOIN speedbox_tiendas s ON s.usuario_id = e.usuario_id AND s.environment = :environment
    LEFT JOIN speedbox_pedidos p ON p.envio_id = e.id AND p.environment = s.environment
    WHERE s.activo = TRUE AND s.tienda_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM envio_items i
        JOIN envio_item_componentes c ON c.envio_item_id = i.id
        JOIN productos pr ON pr.id = c.producto_id
        WHERE i.envio_id = e.id AND pr.creado_por IS DISTINCT FROM e.usuario_id
      )
      AND (e.created_at >= s.enabled_at OR p.estado = 'pendiente')
      AND e.estado IN ('Confirmado', 'Preparado', 'Despachado', 'Reprogramado')
      AND e.stock_descontado = TRUE AND e.stock_liberado = FALSE
      AND (p.id IS NULL OR p.estado = 'pendiente')
    ORDER BY e.id LIMIT 20`, { replacements: { environment: environment() } });
  const { logger } = require('../../utils/logger');
  for (const candidate of candidates) {
    try { await sendOrder(candidate.usuario_id, candidate.id); }
    catch (error) { logger.warn({ evento: 'SPEEDBOX_ORDER_FAILED', envioId: candidate.id, message: client.redact(error.message) }); }
  }
  const [supplyCandidates] = await sequelize.query(`
    SELECT sa.id, sa.usuario_id
    FROM solicitudes_abastecimiento sa
    JOIN speedbox_tiendas s ON s.usuario_id = sa.usuario_id AND s.environment = :environment
    LEFT JOIN speedbox_pedidos p ON p.solicitud_abastecimiento_id = sa.id AND p.environment = s.environment
    WHERE sa.tipo_logistica = 'PROPIA'
      AND sa.deposito_destino_id IS NOT NULL
      AND s.activo = TRUE AND s.tienda_id IS NOT NULL
      AND sa.created_at >= COALESCE(s.enabled_at, '1970-01-01'::timestamptz)
      AND (p.id IS NULL OR p.estado = 'pendiente')
    ORDER BY sa.id LIMIT 20`, { replacements: { environment: environment() } });
  for (const candidate of supplyCandidates) {
    try { await sendSupplyRequest(candidate.usuario_id, candidate.id); }
    catch (error) { logger.warn({ evento: 'SPEEDBOX_SUPPLY_FAILED', solicitudId: candidate.id, message: client.redact(error.message) }); }
  }
  const events = require('./events');
  await events.retryPending();
  try { await events.pollUpdates(); }
  catch (error) { logger.warn({ evento: 'SPEEDBOX_UPDATES_FAILED', message: client.redact(error.message) }); }
}

async function assertCanChange(envio, changes, transaction) {
  const quiereCambiarEstado = changes.estado !== undefined
    && changes.estado !== null
    && String(changes.estado) !== String(envio.estado);
  const quiereCambiarCourier = changes.courier_id !== undefined
    && String(changes.courier_id) !== String(envio.courier_id);
  if (!quiereCambiarEstado && !quiereCambiarCourier && !changes.delete) return;
  const mapping = await SpeedboxPedido.findOne({ where: { environment: environment(), envio_id: envio.id,
    estado: { [Op.in]: ['enviando', 'enviado', 'incierto'] } }, transaction });
  if (!mapping) return;
  if (quiereCambiarEstado) {
    fail('Este pedido ya se envió a RAHA. Su estado logístico se actualiza únicamente desde RAHA.', 409);
  }
  if (changes.delete || quiereCambiarCourier) {
    fail('Este pedido ya se envió a RAHA. Conciliá su cancelación con el proveedor antes de liberar stock o cambiar el courier.', 409);
  }
}

module.exports = { environment, registrationUrl, productionRequestUrl, webhookUrl, queueConfirmedOrder, dispatchConfirmedOrder,
  queueSupplyRequest, dispatchSupplyRequest, connectionFor, status, configure, registerStore, verifySpec, verifyOrder,
  verifyUpdates, sendOrder, sendSupplyRequest, runCycle, assertCanChange };
