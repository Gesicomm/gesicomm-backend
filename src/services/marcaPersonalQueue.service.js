'use strict';
const { Queue, Worker } = require('bullmq');
const { getRedisConnection } = require('./queue/redisConnection');
const service = require('./marcaPersonal.service');
const { logger } = require('../utils/logger');
const NAME = 'gesicom-marca-personal';
let queue, worker;
function getQueue() {
  if (!queue) queue = new Queue(NAME, { connection: getRedisConnection() });
  return queue;
}
async function enqueue(id) {
  if (!service.configured()) return;
  await getQueue().add('provision', { id: Number(id) }, {
    jobId: 'usuario-' + id, attempts: 8, backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: true, removeOnFail: 100,
  });
}
function enqueueSafely(id) {
  void enqueue(id).catch(() => logger.warn({ evento: 'MARCA_PERSONAL_COLA_NO_DISPONIBLE', usuarioId: id }));
}
async function start() {
  if (!service.configured() || worker) return;
  const { Usuario } = require('../models');
  // Se encola después del commit: una operación revertida nunca crea usuarios en T2E.
  const hook = (user, options = {}) => {
    if (options.transaction) options.transaction.afterCommit(() => { enqueueSafely(user.id); });
    else enqueueSafely(user.id);
  };
  Usuario.addHook('afterCreate', 'marca-personal', hook);
  Usuario.addHook('afterUpdate', 'marca-personal', hook);
  worker = new Worker(NAME, async job => {
    if (job.name === 'reconcile') {
      const ids=new Set(await service.remote().managedIds());
      const since=process.env.MARCA_PERSONAL_REGISTRATION_SINCE;
      // Recupera altas nuevas incluso si Redis estuvo caído durante el registro.
      // No da de alta masivamente usuarios históricos sin que entren al módulo.
      if (since && Number.isFinite(Date.parse(since))) {
        const { Op } = require('sequelize');
        let after=0;
        for (;;) {
          const rows=await Usuario.findAll({where:{id:{[Op.gt]:after},createdAt:{[Op.gte]:new Date(since)}},attributes:['id'],order:[['id','ASC']],limit:500});
          for(const row of rows)ids.add(Number(row.id));
          if(rows.length<500)break;
          after=Number(rows[rows.length-1].id);
        }
      }
      for (const id of ids) await enqueue(id);
    } else {
      await service.provisionUser(job.data.id);
    }
  }, { connection: getRedisConnection(), concurrency: 2 });
  worker.on('failed', job => logger.warn({ evento: 'MARCA_PERSONAL_REINTENTO', usuarioId: job?.data?.id }));
  worker.on('error', () => logger.warn({ evento: 'MARCA_PERSONAL_WORKER_NO_DISPONIBLE' }));
  await getQueue().add('reconcile', {}, { jobId: 'reconciliar', repeat: { every: 300000 }, removeOnComplete: true, removeOnFail: 20 });
  await getQueue().add('reconcile', {}, { jobId: 'inicio-'+Date.now(), removeOnComplete:true,removeOnFail:20 });
}
module.exports = { start, enqueue, enqueueSafely };
