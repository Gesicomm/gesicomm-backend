'use strict';

const { sequelize, SeguimientoRecordatorio, Notificacion, Envio } = require('../../models');
const { Transaction, UniqueConstraintError } = require('sequelize');
const { logger } = require('../../utils/logger');

/**
 * Procesa UN recordatorio vencido (BE-18): lo usan tanto el worker de
 * BullMQ como el job de reconciliación (BE-20), con la misma lógica —no
 * hay dos caminos distintos para la misma regla de negocio.
 *
 * Idempotente (BE-21): la fila se bloquea y se revalida su estado/versión
 * DENTRO de la transacción antes de tocar nada, y la notificación se crea
 * con una unique constraint (tipo, entidad_tipo, entidad_id) que actúa como
 * segunda red — si por lo que sea dos procesos llegan a la vez, el segundo
 * INSERT falla silenciosamente en vez de duplicar el aviso.
 *
 * @param {number} recordatorioId
 * @param {number} [versionEsperada] — si viene (caso worker), se descarta el job si ya no coincide con la versión vigente (BE-23).
 */
async function procesarRecordatorioVencido(recordatorioId, versionEsperada) {
  const t = await sequelize.transaction();
  try {
    const recordatorio = await SeguimientoRecordatorio.findByPk(recordatorioId, {
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
    });

    if (!recordatorio) {
      await t.rollback();
      return { procesado: false, razon: 'Recordatorio no encontrado' };
    }
    if (versionEsperada !== undefined && recordatorio.version !== versionEsperada) {
      await t.rollback();
      return { procesado: false, razon: 'Versión obsoleta (el recordatorio fue reprogramado)' };
    }
    if (recordatorio.estado !== 'PENDIENTE') {
      await t.rollback();
      return { procesado: false, razon: `Ya estaba en estado "${recordatorio.estado}"` };
    }
    if (new Date(recordatorio.ejecutar_en).getTime() > Date.now()) {
      await t.rollback();
      return { procesado: false, razon: 'Todavía no llegó la hora de ejecución' };
    }

    const envio = await Envio.findByPk(recordatorio.envio_id, { transaction: t });
    if (!envio) {
      await t.rollback();
      return { procesado: false, razon: 'Pedido no encontrado' };
    }

    await recordatorio.update({ estado: 'VENCIDO' }, { transaction: t });

    try {
      await Notificacion.create({
        usuario_id: recordatorio.usuario_id,
        tipo: 'SEGUIMIENTO_PEDIDO_VENCIDO',
        entidad_tipo: 'seguimiento_recordatorio',
        entidad_id: recordatorio.id,
        envio_id: envio.id,
        titulo: 'Seguimiento pendiente',
        mensaje: `El pedido #${envio.numero_pedido || envio.id} requiere un nuevo contacto.`,
      }, { transaction: t });
    } catch (error) {
      if (!(error instanceof UniqueConstraintError)) throw error;
      // Ya existía la notificación para este recordatorio: idempotencia OK, no es un error.
    }

    await t.commit();
    return { procesado: true };
  } catch (error) {
    if (!t.finished) await t.rollback();
    logger.error({ mensaje: '[SeguimientoVencido] Error procesando recordatorio.', recordatorioId, error: error.message });
    return { procesado: false, razon: error.message };
  }
}

module.exports = { procesarRecordatorioVencido };
