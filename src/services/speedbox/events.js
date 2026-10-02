'use strict';
const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize, Envio, EnvioItem, SpeedboxPedido, SpeedboxTienda, SpeedboxEvento, EnvioHistorial } = require('../../models');
const client = require('./client');
const { environment } = require('./service');

const STATES = { cargado: 'Preparado', en_camino: 'Despachado', entregado: 'Entregado', devuelto: 'Devuelto' };
const RANK = { cargado: 1, en_camino: 2, entregado: 3, devuelto: 3 };
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function normalize(input, source) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Evento Speedbox invalido.');
  const type = input.event || input.type;
  if (typeof type !== 'string' || type.length > 100 || !type.trim()) fail('Falta el tipo de evento.');
  const data = input.data || { ...input.payload,
    ...(input.order_id == null ? {} : { order_id: input.order_id }),
    ...(input.tienda_id == null ? {} : { tienda_id: input.tienda_id }) };
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Datos de evento invalidos.');
  const orderId = data.order_id == null ? null : client.remoteId(data.order_id);
  const storeId = data.tienda_id == null ? null : client.remoteId(data.tienda_id);
  const occurred = input.occurred_at || input.created_at || null;
  if (occurred && (typeof occurred !== 'string' || !Number.isFinite(Date.parse(occurred)))) fail('Fecha de evento invalida.');
  if (type === 'shipment.status_changed' && (!orderId || !Object.hasOwn(STATES, data.status))) fail('Estado o pedido Speedbox invalido.');
  if (type === 'wallet.transaction' && (!storeId || !['credit', 'debit'].includes(data.direction) || data.currency !== 'PYG' ||
      typeof data.amount !== 'number' || !Number.isFinite(data.amount) || data.amount < 0)) fail('Movimiento de billetera invalido.');
  const eventId = input.event_id;
  if (eventId != null && (typeof eventId !== 'string' || !eventId.trim() || eventId.length > 150)) fail('event_id invalido.');
  // Updates may omit IDs. Hash the full observation; do not infer a wallet balance.
  const eventKey = eventId ? `id:${eventId}` : `hash:${crypto.createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex')}`;
  return { environment: environment(), event_key: eventKey, tipo: type, order_id: orderId, tienda_id: storeId,
    occurred_at: occurred ? new Date(occurred) : null, source, payload: client.redact(input), data, hasId: Boolean(eventId) };
}

async function apply(event, transaction) {
  const normalized = normalize(event.payload, event.source);
  const { data } = normalized;
  if (event.tipo === 'wallet.transaction') {
    const connection = await SpeedboxTienda.findOne({ where: { environment: event.environment, tienda_id: event.tienda_id }, transaction });
    if (!connection) return event.update({ estado: 'pendiente', detalle: 'Tienda Speedbox todavia no vinculada.' }, { transaction });
    return event.update({ usuario_id: connection.usuario_id, estado: normalized.hasId ? 'procesado' : 'revision',
      detalle: normalized.hasId ? null : 'Observacion sin event_id: no se acredita saldo local.' }, { transaction });
  }
  if (event.tipo !== 'shipment.status_changed') return event.update({ estado: 'ignorado', detalle: 'Tipo de evento no soportado.' }, { transaction });
  const mapping = await SpeedboxPedido.findOne({ where: { environment: event.environment, order_id: event.order_id }, transaction, lock: transaction.LOCK.UPDATE });
  if (!mapping) return event.update({ estado: 'pendiente', detalle: 'Pedido Speedbox todavia no vinculado.' }, { transaction });
  const connection = await SpeedboxTienda.findOne({ where: { environment: event.environment, usuario_id: mapping.usuario_id }, transaction });
  if (event.tienda_id && event.tienda_id !== connection?.tienda_id) fail('El evento no corresponde a la tienda del pedido.', 409);
  const envio = await Envio.findOne({ where: { id: mapping.envio_id, usuario_id: mapping.usuario_id }, transaction, lock: transaction.LOCK.UPDATE });
  if (!envio) return event.update({ estado: 'ignorado', detalle: 'Pedido local eliminado.' }, { transaction });
  const status = data.status;
  const oldTime = mapping.status_at ? new Date(mapping.status_at).getTime() : null;
  const stale = oldTime && event.occurred_at && event.occurred_at.getTime() < oldTime;
  const regresses = RANK[status] < (RANK[mapping.status] || 0);
  const conflicts = RANK[mapping.status] === 3 && mapping.status !== status;
  if (stale || regresses || conflicts) return event.update({ usuario_id: mapping.usuario_id, estado: 'ignorado', detalle: 'Evento anterior o incompatible con el estado terminal.' }, { transaction });
  let review = null;
  const target = STATES[status];
  const updates = { estado_logistico: target };
  if (['Cancelado', 'Perdido', 'Devuelto'].includes(envio.estado) || (envio.estado === 'Entregado' && target !== 'Entregado')) {
    review = 'El estado local es terminal; requiere conciliacion.';
  } else if (target === 'Devuelto') {
    review = 'Devolucion pendiente de inspeccion por producto; registra la condicion fisica antes de reponer stock.';
    if (envio.stock_descontado && !envio.stock_liberado && !envio.stock_despachado && ['Confirmado', 'Preparado'].includes(envio.estado)) {
      const inventory = require('../../controllers/envioController');
      const items = await EnvioItem.findAll({ where: { envio_id: envio.id }, transaction });
      await inventory.moverAReservadoATransito(items, transaction);
      await envio.update({ stock_despachado: true, estado: 'Despachado' }, { transaction });
    }
  } else if (envio.estado !== target) {
    if (['Despachado', 'Reprogramado', 'Entregado'].includes(envio.estado) && target === 'Preparado') {
      review = 'El pedido local ya avanzo mas que este evento.';
    } else if (!envio.stock_descontado || envio.stock_liberado) {
      review = 'El pedido no tiene una reserva de stock activa.';
    } else {
      const inventory = require('../../controllers/envioController');
      const items = await EnvioItem.findAll({ where: { envio_id: envio.id }, transaction });
      if (['Despachado', 'Entregado'].includes(target) && !envio.stock_despachado) {
        await inventory.moverAReservadoATransito(items, transaction);
        await envio.update({ stock_despachado: true, dispatchedAt: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' }) }, { transaction });
      }
      if (target === 'Entregado') {
        await inventory.consumirTransito(envio, items, transaction);
        if (!envio.metodo_pago_id) review = 'Entrega confirmada. Completa el metodo de pago real en el pedido para la rendicion.';
      }
      updates.estado = target;
    }
  }
  if (!review || !['Cancelado', 'Perdido', 'Devuelto', 'Entregado'].includes(envio.estado)) await envio.update(updates, { transaction });
  if (mapping.status !== status || review) await EnvioHistorial.create({ envio_id: envio.id, usuario_id: mapping.usuario_id,
    detalle: `Speedbox: ${status}${review ? ' (requiere revision)' : ''}`, actor_tipo: 'SISTEMA',
    metadata: { speedbox_event_key: event.event_key, speedbox_order_id: event.order_id, revision: review } }, { transaction });
  await mapping.update({ status, status_at: event.occurred_at || mapping.status_at }, { transaction });
  await event.update({ usuario_id: mapping.usuario_id, estado: review ? 'revision' : 'procesado', detalle: review }, { transaction });
  if (event.source === 'webhook') await SpeedboxTienda.update({ webhook_verified_at: new Date() },
    { where: { usuario_id: mapping.usuario_id, environment: event.environment }, transaction });
  return event;
}

async function ingest(input, source) {
  const normalized = normalize(input, source);
  return sequelize.transaction(async transaction => {
    const key = crypto.createHash('sha256').update(`${normalized.environment}:${normalized.event_key}`).digest().readInt32BE(0);
    await sequelize.query('SELECT pg_advisory_xact_lock(84271005, :key)', { replacements: { key }, transaction });
    const [event, created] = await SpeedboxEvento.findOrCreate({
      where: { environment: normalized.environment, event_key: normalized.event_key },
      defaults: { ...normalized, data: undefined, hasId: undefined }, transaction,
    });
    if (!created && event.estado !== 'pendiente') {
      // The same event may first arrive through updates, then via webhook.
      if (source === 'webhook' && event.tipo === 'shipment.status_changed' && event.estado === 'procesado' && event.usuario_id) {
        await SpeedboxTienda.update({ webhook_verified_at: new Date() }, { where: { usuario_id: event.usuario_id, environment: event.environment }, transaction });
      }
      return { ok: true, duplicate: true, status: normalized.data.status || null, estado: event.estado };
    }
    await apply(event, transaction);
    return { ok: true, duplicate: !created, status: normalized.data.status || null, estado: event.estado };
  });
}

async function retryPending() {
  const [pending] = await sequelize.query(`
    SELECT e.payload, e.source FROM speedbox_eventos e
    WHERE e.environment = :environment AND e.estado = 'pendiente'
      AND (EXISTS (SELECT 1 FROM speedbox_pedidos p WHERE p.environment = e.environment AND p.order_id = e.order_id)
        OR EXISTS (SELECT 1 FROM speedbox_tiendas s WHERE s.environment = e.environment AND s.tienda_id = e.tienda_id))
    ORDER BY e.id LIMIT 100`, { replacements: { environment: environment() } });
  for (const event of pending) await ingest(event.payload, event.source);
}

async function pollUpdates() {
  client.configuration();
  return sequelize.transaction(async transaction => {
    const [[lock]] = await sequelize.query('SELECT pg_try_advisory_xact_lock(84271006) AS acquired', { transaction });
    if (!lock.acquired) return { ok: true, skipped: true };
    const connections = await SpeedboxTienda.findAll({ where: { environment: environment(), activo: true }, transaction });
    if (!connections.length) return { ok: true, events: 0 };
    const cursors = connections.map(connection => connection.since_at).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b));
    const response = await client.request('updates', { sinceAt: cursors[0] || new Date().toISOString() });
    if (!Array.isArray(response.events) || typeof response.next_since_at !== 'string' || !Number.isFinite(Date.parse(response.next_since_at)) ||
        (cursors[0] && Date.parse(response.next_since_at) < Date.parse(cursors[0]))) fail('Respuesta updates invalida.', 502);
    // Events commit before the cursor. Failure causes the page to be replayed safely.
    for (const input of response.events) await ingest(input, 'updates');
    await SpeedboxTienda.update({ since_at: response.next_since_at, updates_verified_at: new Date() },
      { where: { id: { [Op.in]: connections.map(connection => connection.id) } }, transaction });
    return { ok: true, events: response.events.length, next_since_at: response.next_since_at };
  });
}

module.exports = { normalize, ingest, pollUpdates, retryPending, STATES };
