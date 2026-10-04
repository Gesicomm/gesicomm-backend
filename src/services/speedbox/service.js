'use strict';
const { Op } = require('sequelize');
const { z } = require('zod');
const { sequelize, Tienda, Courier, Envio, EnvioItem, EnvioItemComponente, Producto, ProductoVariante,
  SpeedboxTienda, SpeedboxPedido, SpeedboxEvento, SolicitudAbastecimiento } = require('../../models');
const client = require('./client');
const { buildOrder } = require('./payload');

function environment() { return process.env.SPEEDBOX_ENVIRONMENT || 'sandbox'; }
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }

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

async function queueConfirmedOrder(envio, transaction) {
  if (process.env.SPEEDBOX_ENABLED !== 'true' || envio.estado !== 'Confirmado' || !envio.stock_descontado || envio.stock_liberado) return null;
  const connection = await SpeedboxTienda.findOne({ where: { usuario_id: envio.usuario_id, environment: environment(), activo: true }, transaction });
  if (!connection?.tienda_id || connection.courier_id !== envio.courier_id) return null;
  const [mapping] = await SpeedboxPedido.findOrCreate({ where: { environment: environment(), envio_id: envio.id },
    defaults: { usuario_id: envio.usuario_id, external_order_id: `GESICOMM-${environment()}-${envio.usuario_id}-${envio.id}` }, transaction });
  if (mapping.estado === 'pendiente') {
    // Commit the outbox with confirmation; never send an uncommitted order.
    transaction.afterCommit(() => { setImmediate(() => { void dispatchConfirmedOrder(envio.usuario_id, envio.id); }); });
  }
  return mapping;
}

async function connectionFor(usuarioId, options = {}) {
  const connection = await SpeedboxTienda.findOne({ where: { usuario_id: usuarioId, environment: environment() }, ...options });
  if (!connection) fail('Vincula primero tu tienda con Speedbox.', 409);
  return connection;
}

async function status(usuarioId) {
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
    WHERE e.usuario_id = :usuario AND e.courier_id = :courier AND p.id IS NULL
      AND e.estado IN ('Confirmado', 'Preparado', 'Despachado', 'Reprogramado')
      AND e.stock_descontado = TRUE AND e.stock_liberado = FALSE
    ORDER BY e.id DESC LIMIT 50`, { replacements: { usuario: usuarioId, courier: connection?.courier_id || null, environment: environment() } });
  let credentials = false;
  try { client.configuration(); credentials = true; } catch { /* Configuration is private and may be incomplete. */ }
  return { environment: environment(), credentials_configured: credentials,
    registration_url: registrationUrl(),
    automatic_enabled: process.env.SPEEDBOX_ENABLED === 'true',
    webhook_configured: Boolean(process.env.SPEEDBOX_WEBHOOK_TOKEN?.length >= 32),
    connection, orders: orders.map(order => ({ ...order.toJSON(), finanzas: order.envio ? require('./finanzas').desglose(order.envio) : null })),
    events, solicitudes_abastecimiento: solicitudes, available_orders: availableOrders,
    checks: { spec: Boolean(connection?.spec_verified_at), order: orderVerified > 0,
      updates: Boolean(connection?.updates_verified_at), webhook: Boolean(connection?.webhook_verified_at) } };
}

const configSchema = z.object({ courier_id: z.number().int().positive().nullable(), activo: z.boolean() }).strict();
async function configure(usuarioId, input) {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) fail('Configuracion Speedbox invalida.');
  const { courier_id: courierId, activo } = parsed.data;
  if (courierId) {
    const courier = await Courier.findOne({ where: { id: courierId, activo: true, [Op.or]: [{ usuario_id: usuarioId }, { alcance: 'GESICOMM' }] } });
    if (!courier) fail('Courier no disponible para esta tienda.');
  }
  if (activo && !courierId) fail('Selecciona el courier Speedbox.');
  if (activo) {
    client.configuration();
    if (!process.env.SPEEDBOX_WEBHOOK_TOKEN || process.env.SPEEDBOX_WEBHOOK_TOKEN.length < 32) fail('Configura el token privado del webhook en el servidor.', 409);
  }
  return sequelize.transaction(async transaction => {
    const connection = await connectionFor(usuarioId, { transaction, lock: transaction.LOCK.UPDATE });
    if (activo && !connection.tienda_id) fail('Vincula primero tu tienda Speedbox.', 409);
    return connection.update({ courier_id: courierId, activo,
      enabled_at: activo && !connection.activo ? new Date() : connection.enabled_at,
      since_at: connection.since_at || new Date().toISOString() }, { transaction });
  });
}

async function registerStore(usuarioId) {
  const { environment: env } = client.configuration();
  const tienda = await Tienda.findOne({ where: { usuario_id: usuarioId } });
  if (!tienda) fail('Primero configura tu tienda.', 404);
  return sequelize.transaction(async transaction => {
    await sequelize.query('SELECT pg_advisory_xact_lock(84271004, :usuario)', { replacements: { usuario: Number(usuarioId) }, transaction });
    const [connection] = await SpeedboxTienda.findOrCreate({ where: { usuario_id: usuarioId, environment: env }, defaults: { since_at: new Date().toISOString() }, transaction });
    if (connection.tienda_id) return connection;
    const response = await client.request('store', { method: 'POST', body: {
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

async function verifySpec(usuarioId) {
  const tienda = await Tienda.findOne({ where: { usuario_id: usuarioId } });
  if (!tienda) fail('Primero configura tu tienda.', 404);
  await client.request('spec');
  const [connection] = await SpeedboxTienda.findOrCreate({ where: { usuario_id: usuarioId, environment: environment() }, defaults: { since_at: new Date().toISOString() } });
  await connection.update({ spec_verified_at: new Date() });
  return { ok: true };
}

async function sendOrder(usuarioId, envioId, { retry = false, acknowledgeUncertain = false } = {}) {
  client.configuration();
  const claimed = await sequelize.transaction(async transaction => {
    const connection = await connectionFor(usuarioId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!connection.activo || !connection.tienda_id) fail('Speedbox no esta activo para esta tienda.', 409);
    const envio = await Envio.findOne({ where: { id: envioId, usuario_id: usuarioId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!envio) fail('Pedido no encontrado.', 404);
    const [mapping] = await SpeedboxPedido.findOrCreate({ where: { environment: environment(), envio_id: envio.id },
      defaults: { usuario_id: usuarioId, external_order_id: `GESICOMM-${environment()}-${usuarioId}-${envio.id}` }, transaction });
    if (mapping.order_id) return { mapping, sent: true };
    if (mapping.estado === 'enviando' && Date.now() - new Date(mapping.updated_at).getTime() < 120000) fail('El envio sigue en curso. Espera antes de conciliar o reintentar.', 409);
    if (mapping.estado !== 'pendiente' && !retry) fail('El pedido requiere un reintento manual.', 409);
    if (['enviando', 'incierto'].includes(mapping.estado) && !acknowledgeUncertain) fail('Verifica en Speedbox si el pedido ya existe antes de autorizar el reintento.', 409);
    if (!['Confirmado', 'Preparado', 'Despachado', 'Reprogramado'].includes(envio.estado) || !envio.stock_descontado || envio.stock_liberado) fail('El pedido debe estar confirmado y con stock reservado.', 409);
    if (envio.courier_id !== connection.courier_id) fail('El pedido debe estar asignado al courier Speedbox.', 409);
    // An uncertain submission always retains its original payload and external ID.
    let payload = mapping.request_payload;
    if (!payload || mapping.estado === 'error') {
      const tienda = await Tienda.findOne({ where: { usuario_id: usuarioId }, transaction });
      if (!tienda) fail('Tienda no encontrada.', 404);
      envio.items = await EnvioItem.findAll({ where: { envio_id: envio.id }, transaction, order: [['id', 'ASC']], include: [
        { model: EnvioItemComponente, as: 'componentes_vendidos', include: [{ model: Producto, as: 'producto', attributes: ['id', 'sku', 'nombre'] }] },
      ] });
      const ids = envio.items.flatMap(item => item.componentes_vendidos.map(component => component.variante_id)).filter(Boolean);
      const variants = ids.length ? await ProductoVariante.findAll({ where: { id: { [Op.in]: ids } }, transaction }) : [];
      try { payload = buildOrder(envio, tienda, connection, new Map(variants.map(variant => [variant.id, variant]))); }
      catch (error) {
        await mapping.update({ estado: 'error', error: error.message }, { transaction });
        return { mapping, validationError: error };
      }
    }
    await mapping.update({ estado: 'enviando', request_payload: payload, error: null, intentos: mapping.intentos + 1 }, { transaction });
    return { mapping };
  });
  if (claimed.validationError) throw claimed.validationError;
  if (claimed.sent) return claimed.mapping;
  const mapping = claimed.mapping;
  let response;
  try {
    response = await client.request('order', { method: 'POST', body: mapping.request_payload });
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

async function runCycle() {
  if (process.env.SPEEDBOX_ENABLED !== 'true') return;
  client.configuration();
  const [candidates] = await sequelize.query(`
    SELECT e.id, e.usuario_id FROM envios e
    JOIN speedbox_tiendas s ON s.usuario_id = e.usuario_id AND s.environment = :environment
    LEFT JOIN speedbox_pedidos p ON p.envio_id = e.id AND p.environment = s.environment
    WHERE s.activo = TRUE AND e.courier_id = s.courier_id
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
  const events = require('./events');
  await events.retryPending();
  try { await events.pollUpdates(); }
  catch (error) { logger.warn({ evento: 'SPEEDBOX_UPDATES_FAILED', message: client.redact(error.message) }); }
}

async function assertCanChange(envio, changes, transaction) {
  if (changes.estado !== 'Cancelado' && changes.courier_id === undefined && !changes.delete) return;
  const mapping = await SpeedboxPedido.findOne({ where: { environment: environment(), envio_id: envio.id,
    estado: { [Op.in]: ['enviando', 'enviado', 'incierto'] } }, transaction });
  if (mapping && (changes.estado === 'Cancelado' || changes.delete || String(changes.courier_id) !== String(envio.courier_id))) {
    fail('Este pedido ya se envio a Speedbox. Concilia su cancelacion con el proveedor antes de liberar stock o cambiar el courier.', 409);
  }
}

module.exports = { environment, registrationUrl, queueConfirmedOrder, dispatchConfirmedOrder,
  connectionFor, status, configure, registerStore, verifySpec, sendOrder, runCycle, assertCanChange };
