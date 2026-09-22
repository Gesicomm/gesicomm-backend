'use strict';

/**
 * Historial simple de movimientos de un pedido (ver plan Gestión de
 * Pedidos sección 24). Una sola función compartida entre envioController.js
 * y liquidacion.service.js para no repetir el mismo INSERT en dos lugares.
 * Nunca debe hacer fallar la operación principal — un error al loguear
 * historial no debería revertir un cambio de estado real.
 */
async function registrarHistorial(envio_id, usuario_id, detalle, transaction, opts = {}) {
  try {
    const { EnvioHistorial } = require('../models');
    const { estadoAnterior = null, estadoNuevo = null, actorTipo = null, metadata = null } = opts;
    return await EnvioHistorial.create({
      envio_id,
      usuario_id: usuario_id || null,
      detalle,
      estado_anterior: estadoAnterior,
      estado_nuevo: estadoNuevo,
      actor_tipo: actorTipo,
      metadata,
    }, { transaction });
  } catch (err) {
    console.error('No se pudo registrar historial de pedido:', err.message);
    return null;
  }
}

module.exports = { registrarHistorial };
