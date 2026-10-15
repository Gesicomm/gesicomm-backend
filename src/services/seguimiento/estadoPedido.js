'use strict';

// Estado para comunicaciones. RAHA puede avanzar aunque el inventario local
// necesite conciliación; esto no modifica reservas ni el estado contable.
const ESTADOS_RAHA = {
  pendiente_confirmacion: 'Confirmado',
  cargado: 'Preparado', en_camino: 'Despachado',
  entregado: 'Entregado', devuelto: 'Devuelto',
};
const ESTADOS_LOCALES_PRIORITARIOS = ['Cancelado', 'Perdido', 'Devuelto', 'Entregado'];

function estadoParaSeguimiento(pedido) {
  if (ESTADOS_LOCALES_PRIORITARIOS.includes(pedido?.estado)) return pedido.estado;
  if (pedido?.estado_seguimiento) return pedido.estado_seguimiento;
  const raha = pedido?.raha_logistica;
  return (raha?.gestionado && ESTADOS_RAHA[raha.status || 'pendiente_confirmacion']) || pedido?.estado;
}

function fechaEntregaSeguimiento(pedido) {
  const raha = pedido?.raha_logistica;
  return pedido?.entregado_raha_en || (raha?.gestionado && raha.status === 'entregado' ? raha.status_at : null);
}

function esperandoConfirmacionLogistica(pedido) {
  return estadoParaSeguimiento(pedido) === 'Confirmado'
    && (pedido?.raha_status === 'pendiente_confirmacion'
      || (pedido?.raha_logistica?.gestionado && (!pedido.raha_logistica.status || pedido.raha_logistica.status === 'pendiente_confirmacion')));
}

function enSeguimientoEnvio(pedido) {
  return ['Preparado', 'Despachado', 'Reprogramado'].includes(estadoParaSeguimiento(pedido)) || Boolean(esperandoConfirmacionLogistica(pedido));
}

function esperandoConfirmacionLogisticaSql() {
  return `(${estadoSeguimientoSql()} = 'Confirmado' AND ${statusRahaSql()} = 'pendiente_confirmacion')`;
}

function seguimientoEnvioSql() {
  return `(${estadoSeguimientoSql()} IN ('Preparado', 'Despachado', 'Reprogramado') OR ${esperandoConfirmacionLogisticaSql()})`;
}

// La misma proyección en SQL, antes de paginar o contar. Sin interpolar datos
// del cliente: alias y casos son constantes del código.
function statusRahaSql() {
  return `(SELECT COALESCE(sp.status, 'pendiente_confirmacion') FROM speedbox_pedidos sp
    WHERE sp.envio_id = "Envio"."id" AND sp.usuario_id = "Envio"."usuario_id"
      AND sp.order_id IS NOT NULL AND sp.estado IN ('enviado', 'enviando', 'incierto')
    ORDER BY sp.updated_at DESC, sp.id DESC LIMIT 1)`;
}

function estadoSeguimientoSql() {
  const casos = Object.entries(ESTADOS_RAHA).map(([status, estado]) => `WHEN '${status}' THEN '${estado}'`).join('\n');
  return `(CASE WHEN "Envio"."estado" IN (${ESTADOS_LOCALES_PRIORITARIOS.map(e => `'${e}'`).join(',')})
    THEN "Envio"."estado" ELSE COALESCE((CASE ${statusRahaSql()} ${casos} END), "Envio"."estado") END)`;
}

function fechaEntregaRahaSql() {
  return `(SELECT sp.status_at FROM speedbox_pedidos sp
    WHERE sp.envio_id = "Envio"."id" AND sp.usuario_id = "Envio"."usuario_id"
      AND sp.order_id IS NOT NULL AND sp.estado IN ('enviado', 'enviando', 'incierto')
      AND sp.status = 'entregado'
    ORDER BY sp.updated_at DESC, sp.id DESC LIMIT 1)`;
}

module.exports = { estadoParaSeguimiento, fechaEntregaSeguimiento, estadoSeguimientoSql, statusRahaSql, fechaEntregaRahaSql, esperandoConfirmacionLogistica, enSeguimientoEnvio, esperandoConfirmacionLogisticaSql, seguimientoEnvioSql };
