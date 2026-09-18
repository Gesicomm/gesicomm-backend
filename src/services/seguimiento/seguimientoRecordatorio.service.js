'use strict';

const { SeguimientoRecordatorio } = require('../../models');
const { logger } = require('../../utils/logger');

// Estados de Envio que terminan la necesidad de seguimiento (BE-22). Cuando
// un pedido llega a cualquiera de estos, sus recordatorios PENDIENTE se
// cancelan — no hace falta borrar el job en BullMQ: si eventualmente se
// dispara, el worker va a encontrar el recordatorio CANCELADO y no va a
// notificar nada (ver seguimientoWorker.js).
const ESTADOS_TERMINALES_SEGUIMIENTO = ['Confirmado', 'Cancelado', 'Entregado', 'Devuelto', 'Perdido'];

/**
 * Cancela los recordatorios PENDIENTE de un pedido. Se llama después de
 * commitear el cambio de estado, nunca dentro de esa misma transacción: es
 * limpieza secundaria y un error acá no puede tumbar el cambio de estado
 * real (mismo criterio que registrarHistorial).
 */
async function cancelarRecordatoriosPendientes(envioId) {
  try {
    await SeguimientoRecordatorio.update(
      { estado: 'CANCELADO', cancelado_en: new Date() },
      { where: { envio_id: envioId, estado: 'PENDIENTE' } },
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

module.exports = {
  ESTADOS_TERMINALES_SEGUIMIENTO,
  cancelarRecordatoriosPendientes,
  cancelarSiEstadoTerminal,
};
