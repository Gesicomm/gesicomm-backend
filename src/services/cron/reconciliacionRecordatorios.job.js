'use strict';

const cron = require('node-cron');
const { Op } = require('sequelize');
const { sequelize, SeguimientoRecordatorio } = require('../../models');
const { procesarRecordatorioVencido } = require('../seguimiento/seguimientoVencido.service');
const { logger } = require('../../utils/logger');

/**
 * Backstop de BE-20: PostgreSQL es la fuente de verdad de los recordatorios,
 * la cola de BullMQ es solo el disparador. Este job hace UNA consulta por
 * lote (no una por pedido — 10, 70 o 10.000 recordatorios programados no
 * son 10, 70 o 10.000 conexiones) para encontrar los que quedaron
 * PENDIENTE y vencidos sin haber sido procesados (Redis caído, worker
 * caído, deploy en medio del delay, etc.) y los resuelve con la misma
 * lógica que usa el worker (procesarRecordatorioVencido, ya idempotente).
 *
 * Mismo patrón de advisory lock que reconciliacionSuscripciones.job.js: si
 * corren varias instancias del backend, solo una hace el barrido por tick.
 */
const LOCK_KEY = 84271002; // arbitrario, fijo, distinto del de reconciliacionSuscripciones.
const LOTE_MAXIMO = 500;

async function reconciliarRecordatoriosVencidos() {
  const idsAProcesar = await sequelize.transaction(async (t) => {
    const [[{ lock_obtenido }]] = await sequelize.query(
      'SELECT pg_try_advisory_xact_lock(:key) AS lock_obtenido',
      { replacements: { key: LOCK_KEY }, transaction: t },
    );
    if (!lock_obtenido) {
      logger.info('[reconciliacionRecordatorios] Otra instancia ya está corriendo el barrido, se salta este tick.');
      return [];
    }

    const vencidos = await SeguimientoRecordatorio.findAll({
      where: { estado: 'PENDIENTE', ejecutar_en: { [Op.lte]: new Date() } },
      attributes: ['id'],
      limit: LOTE_MAXIMO,
      transaction: t,
    });
    return vencidos.map((r) => r.id);
  });

  if (idsAProcesar.length === 0) return;

  logger.info(`[reconciliacionRecordatorios] Procesando ${idsAProcesar.length} recordatorio(s) vencido(s).`);
  for (const id of idsAProcesar) {
    try {
      await procesarRecordatorioVencido(id);
    } catch (err) {
      logger.error(`[reconciliacionRecordatorios] Error procesando recordatorio ${id}:`, err);
    }
  }
}

/** Corre cada 5 minutos — es el respaldo, no el mecanismo principal. */
function iniciarJobReconciliacionRecordatorios() {
  cron.schedule('*/5 * * * *', () => {
    reconciliarRecordatoriosVencidos().catch((err) => logger.error('[reconciliacionRecordatorios] Error en el job:', err));
  });
}

module.exports = { iniciarJobReconciliacionRecordatorios, reconciliarRecordatoriosVencidos, LOCK_KEY };
