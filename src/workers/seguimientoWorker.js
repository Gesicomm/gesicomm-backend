'use strict';

/**
 * Proceso worker independiente para los recordatorios de seguimiento
 * (BE-18). Se ejecuta separado del servidor HTTP (server.js) — arrancar
 * con `node src/workers/seguimientoWorker.js` o vía PM2/Docker, nunca
 * como setTimeout dentro del proceso web (BE-17).
 */
require('dotenv').config();

const { Worker } = require('bullmq');
const { getRedisConnection } = require('../services/queue/redisConnection');
const { NOMBRE_COLA } = require('../services/queue/seguimientoQueue');
const { procesarRecordatorioVencido } = require('../services/seguimiento/seguimientoVencido.service');
const { logger } = require('../utils/logger');

const worker = new Worker(
  NOMBRE_COLA,
  async (job) => {
    const { recordatorioId, version } = job.data;
    const resultado = await procesarRecordatorioVencido(recordatorioId, version);
    logger.info({ mensaje: '[SeguimientoWorker] Job procesado.', recordatorioId, resultado });
    return resultado;
  },
  { connection: getRedisConnection(), concurrency: 5 },
);

worker.on('failed', (job, err) => {
  logger.error({ mensaje: '[SeguimientoWorker] Job falló.', jobId: job?.id, error: err.message });
});

logger.info({ mensaje: '[SeguimientoWorker] Worker de recordatorios de seguimiento iniciado.' });

process.on('SIGTERM', async () => {
  await worker.close();
  process.exit(0);
});
