'use strict';

const { Op } = require('sequelize');
const { SeguimientoRecordatorio } = require('../../models');
const { logger } = require('../../utils/logger');

// Estados de Envio que terminan la necesidad de seguimiento (BE-22). Cuando
// un pedido llega a cualquiera de estos, sus recordatorios abiertos se
// cancelan — no hace falta borrar el job en BullMQ: si eventualmente se
// dispara, el worker va a encontrar el recordatorio CANCELADO y no va a
// notificar nada (ver seguimientoWorker.js).
const ESTADOS_TERMINALES_SEGUIMIENTO = ['Confirmado', 'Cancelado', 'Entregado', 'Devuelto', 'Perdido'];

// Pedidos que ya no se van a contactar. Un recordatorio vencido colgado de
// uno de estos no es trabajo pendiente y no cuenta en ningún contador.
const ESTADOS_PEDIDO_CERRADO = ['Entregado', 'Cancelado', 'Devuelto', 'Perdido'];

// Un recordatorio sigue "abierto" mientras alguien tenga que hacer algo con
// él. VENCIDO no es un estado final: es un PENDIENTE al que le llegó la hora
// y todavía nadie atendió. Tratarlo como final lo dejaba marcado para siempre
// (no se podía completar, ni cancelar, ni lo cerraba el pedido al confirmarse).
const ESTADOS_ABIERTOS = ['PENDIENTE', 'VENCIDO'];

/**
 * Cancela los recordatorios abiertos de un pedido. Se llama después de
 * commitear el cambio de estado, nunca dentro de esa misma transacción: es
 * limpieza secundaria y un error acá no puede tumbar el cambio de estado
 * real (mismo criterio que registrarHistorial).
 */
async function cancelarRecordatoriosPendientes(envioId) {
  try {
    await SeguimientoRecordatorio.update(
      { estado: 'CANCELADO', cancelado_en: new Date() },
      { where: { envio_id: envioId, estado: { [Op.in]: ESTADOS_ABIERTOS } } },
    );
  } catch (error) {
    logger.error({ mensaje: '[SeguimientoRecordatorio] Error cancelando recordatorios pendientes.', envioId, error: error.message });
  }
}

/** Se llama sin bloquear el response, igual que notificarAbastecimientoPagadoSinBloquear. */
function cancelarSiEstadoTerminal(envioId, nuevoEstado) {
  if (!ESTADOS_TERMINALES_SEGUIMIENTO.includes(nuevoEstado)) return;
  setImmediate(() => {
    cancelarRecordatoriosPendientes(envioId);
  });
}

/**
 * De todos los recordatorios de un pedido, el que manda en la bandeja: el
 * PENDIENTE si hay uno (es lo último que agendó el operador), si no el
 * VENCIDO más reciente, y si no queda nada abierto, el último que hubo.
 *
 * El orden en que llega el array no está garantizado (viene de un include
 * sin ORDER BY), por eso acá no se usa nunca la posición.
 */
function elegirRecordatorioVigente(recordatorios) {
  if (!Array.isArray(recordatorios) || recordatorios.length === 0) return null;
  const masReciente = (lista) => lista.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a));

  const pendientes = recordatorios.filter((r) => r.estado === 'PENDIENTE');
  if (pendientes.length > 0) return masReciente(pendientes);

  const vencidos = recordatorios.filter((r) => r.estado === 'VENCIDO');
  if (vencidos.length > 0) return masReciente(vencidos);

  return masReciente(recordatorios);
}

module.exports = {
  ESTADOS_TERMINALES_SEGUIMIENTO,
  ESTADOS_PEDIDO_CERRADO,
  ESTADOS_ABIERTOS,
  cancelarRecordatoriosPendientes,
  cancelarSiEstadoTerminal,
  elegirRecordatorioVigente,
};
