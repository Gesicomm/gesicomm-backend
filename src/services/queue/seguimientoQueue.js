'use strict';

const { Queue } = require('bullmq');
const { logger } = require('../../utils/logger');

const NOMBRE_COLA = 'seguimiento-recordatorios';

let queue = null;
let redisDisponible = null; // null = sin verificar, true/false = resultado del chequeo

/**
 * Verifica si Redis esta disponible sin colgar el proceso.
 * Usa un timeout de 2 segundos para no bloquear requests.
 */
async function verificarRedis() {
  if (redisDisponible === false) return false; // ya sabemos que no hay Redis, no reintentar
  const IORedis = require('ioredis');
  const conn = new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  try {
    await Promise.race([
      conn.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), 2000))
    ]);
    await conn.ping();
    await conn.quit();
    redisDisponible = true;
    return true;
  } catch {
    await conn.disconnect().catch(() => {});
    redisDisponible = false;
    logger.warn('[SeguimientoQueue] Redis no disponible en entorno local. Los recordatorios se guardan en Postgres y la reconciliacion periodica los ejecutara.');
    return false;
  }
}

async function getQueue() {
  if (!queue) {
    const disponible = await verificarRedis();
    if (!disponible) return null;
    const { getRedisConnection } = require('./redisConnection');
    queue = new Queue(NOMBRE_COLA, { connection: getRedisConnection() });
  }
  return queue;
}

/**
 * Encola el job diferido de un recordatorio (BE-17).
 * Si Redis no esta disponible, NO falla: el recordatorio ya quedo persistido
 * en Postgres y el job de reconciliacion (BE-20) lo ejecutara igual.
 */
async function encolarRecordatorio(recordatorio) {
  try {
    const q = await Promise.race([
      getQueue(),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)) // timeout de 3s
    ]);
    if (!q) {
      logger.warn({ mensaje: '[SeguimientoQueue] Queue no disponible, recordatorio solo en Postgres.', recordatorioId: recordatorio.id });
      return;
    }
    const delayMs = Math.max(0, new Date(recordatorio.ejecutar_en).getTime() - Date.now());
    await q.add(
      'SEGUIMIENTO_PEDIDO',
      { recordatorioId: recordatorio.id, version: recordatorio.version },
      { jobId: `recordatorio:${recordatorio.id}:v${recordatorio.version}`, delay: delayMs, removeOnComplete: true, removeOnFail: 1000 },
    );
  } catch (error) {
    logger.error({ mensaje: '[SeguimientoQueue] No se pudo encolar el recordatorio (la reconciliacion periodica lo cubre).', recordatorioId: recordatorio.id, error: error.message });
  }
}

module.exports = { NOMBRE_COLA, getQueue, encolarRecordatorio };