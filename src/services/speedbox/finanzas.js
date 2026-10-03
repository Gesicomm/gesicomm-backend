'use strict';
const { z } = require('zod');
const { sequelize, Envio, SolicitudAbastecimiento, SpeedboxEvento } = require('../../models');
const { environment } = require('./service');
const { normalize } = require('./events');
const schema = z.object({
  concepto: z.enum(['pago_proveedor', 'costo_abastecimiento', 'envio', 'cobro_cliente', 'otro']),
  envio_id: z.number().int().positive().nullable(),
  solicitud_id: z.number().int().positive().nullable(),
  nota: z.string().trim().min(3).max(500),
}).strict();
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

async function conciliar(usuarioId, eventId, input) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) fail('Datos de conciliacion invalidos.');
  const data = parsed.data;
  if (data.envio_id && data.solicitud_id) fail('Selecciona una sola referencia.');
  if (data.concepto !== 'otro' && !data.envio_id && !data.solicitud_id) fail('El concepto requiere un pedido o solicitud de abastecimiento.');
  if (data.concepto === 'cobro_cliente' && !data.envio_id) fail('El cobro debe referirse a un pedido de venta.');
  return sequelize.transaction(async transaction => {
    const event = await SpeedboxEvento.findOne({ where: { id: eventId, usuario_id: usuarioId,
      environment: environment(), tipo: 'wallet.transaction' }, transaction, lock: transaction.LOCK.UPDATE });
    if (!event) fail('Movimiento no encontrado.', 404);
    const normalized = normalize(event.payload, event.source);
    if (!normalized.hasId || event.estado === 'pendiente') fail('Este movimiento no tiene una identificacion remota verificable.', 409);
    if (data.concepto === 'cobro_cliente' && normalized.data.direction !== 'credit') fail('Un debito no representa un cobro al cliente.');
    if (['pago_proveedor', 'costo_abastecimiento', 'envio'].includes(data.concepto) && normalized.data.direction !== 'debit') {
      fail('Este concepto requiere un debito. Para ajustes o reintegros usa Otro.');
    }
    if (data.envio_id && !await Envio.findOne({ where: { id: data.envio_id, usuario_id: usuarioId }, transaction })) fail('Pedido no encontrado.', 404);
    if (data.solicitud_id && !await SolicitudAbastecimiento.findOne({ where: { id: data.solicitud_id, usuario_id: usuarioId }, transaction })) fail('Solicitud no encontrada.', 404);
    if (event.conciliacion) {
      if (Object.entries(data).some(([key, value]) => event.conciliacion[key] !== value)) fail('El movimiento ya fue conciliado con otro concepto o referencia.', 409);
      return { ok: true, duplicate: true, conciliacion: event.conciliacion };
    }
    const conciliacion = { ...data, usuario_id: usuarioId, conciliado_at: new Date().toISOString(),
      amount: normalized.data.amount, direction: normalized.data.direction, currency: normalized.data.currency,
      event_key: event.event_key };
    // Classification is evidence, not an instruction to settle or pay another ledger.
    await event.update({ conciliacion }, { transaction });
    return { ok: true, duplicate: false, conciliacion };
  });
}

function desglose(envio) {
  return {
    venta: Number(envio.monto),
    envio_cliente: Number(envio.costo_envio),
    fulfillment: Number(envio.costo_fulfillment),
    delivery_a_cargo: envio.delivery_a_cargo || 'cliente',
    cobro_cliente: envio.pago_anticipado ? 'anticipado' : 'contra_entrega',
    costo_abastecimiento: Number(envio.abastecimiento_costo),
    pago_proveedor: envio.abastecimiento_pagado_at ? 'validado' : (envio.abastecimiento_estado || 'no_requiere'),
    pago_proveedor_validado_at: envio.abastecimiento_pagado_at,
    estado_financiero: envio.estado_financiero,
  };
}
module.exports = { conciliar, desglose };
