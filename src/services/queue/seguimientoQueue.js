'use strict';

const { Queue } = require('bullmq');
const { getRedisConnection } = require('./redisConnection');
const { logger } = require('../../utils/logger');

const NOMBRE_COLA = 'seguimiento-recordatorios';

let queue = null;

function getQueue() {
  if (!queue) {
    queue = new Queue(NOMBRE_COLA, { connection: getRedisConnection() });
  }
  return queue;
}

/**
 * Encola el job diferido de un recordatorio (BE-17). El jobId incluye la
 * versión: si el recordatorio se reprograma (BE-23), la versión cambia y
 * este es un job NUEVO con un jobId distinto — el viejo, si llega a
 * disparar, no encuentra coincidencia de versión en el worker y no hace
 * nada (ver seguimientoWorker.js). No hace falta borrarlo de la cola.
 *
 * Nunca debe hacer fallar la operación principal: si Redis está caído, el
 * recordatorio ya quedó persistido en Postgres y el job de reconciliación
 * (BE-20) lo va a encontrar igual.
 */
async function encolarRecordatorio(recordatorio) {
  try {
    const delayMs = Math.max(0, new Date(recordatorio.ejecutar_en).getTime() - Date.now());
    await getQueue().add(
      'SEGUIMIENTO_PEDIDO',
      { recordatorioId: recordatorio.id, version: recordatorio.version },
      { jobId: `recordatorio:${recordatorio.id}:v${recordatorio.version}`, delay: delayMs, removeOnComplete: true, removeOnFail: 1000 },
    );
  } catch (error) {
    logger.error({ mensaje: '[SeguimientoQueue] No se pudo encolar el recordatorio (la reconciliación periódica lo cubre).', recordatorioId: recordatorio.id, error: error.message });
  }
}

module.exports = { NOMBRE_COLA, getQueue, encolarRecordatorio };
