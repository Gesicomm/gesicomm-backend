'use strict';

const IORedis = require('ioredis');
const { logger } = require('../../utils/logger');

/**
 * Conexión Redis compartida para BullMQ (recordatorios de seguimiento,
 * BE-17). `maxRetriesPerRequest: null` es requisito de BullMQ, no un
 * capricho — sin esto, ioredis puede devolver error en vez de reintentar
 * indefinidamente mientras Redis no está disponible, y BullMQ necesita esa
 * espera para no perder jobs.
 */
let connection = null;

function getRedisConnection() {
  if (connection) return connection;

  connection = new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });

  connection.on('error', (err) => {
    logger.error({ mensaje: '[Redis] Error de conexión.', error: err.message });
  });

  return connection;
}

module.exports = { getRedisConnection };
