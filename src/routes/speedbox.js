'use strict';
const express = require('express');
const { verificarToken } = require('../middleware/autenticacion');
const service = require('../services/speedbox/service');
const events = require('../services/speedbox/events');
const router = express.Router();
router.use(verificarToken);
router.use(require('express-rate-limit')({ windowMs: 15 * 60 * 1000, max: 60,
  message: { message: 'Demasiadas operaciones Speedbox. Intenta mas tarde.' } }));
router.param('id', (req, res, next) => {
  if (!Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) <= 0) return res.status(400).json({ message: 'ID de pedido invalido.' });
  next();
});
const handle = handler => async (req, res, next) => {
  try { res.json(await handler(req)); } catch (error) {
    if (error.remoteResponse) require('../utils/logger').logger.warn({ evento: 'SPEEDBOX_API_ERROR',
      ruta: req.path, usuarioId: req.usuario.id, remoteStatus: error.remoteStatus,
      response: require('../services/speedbox/client').redact(error.remoteResponse) });
    if (error.remoteStatus || error.status === 503 || error.uncertain) {
      return res.status(error.status || 502).json({ message: error.message, error: error.message });
    }
    next(error);
  }
};
router.get('/', handle(req => service.status(req.usuario.id)));
router.put('/', handle(req => service.configure(req.usuario.id, req.body)));
router.post('/store', handle(req => service.registerStore(req.usuario.id)));
router.post('/spec', handle(req => service.verifySpec(req.usuario.id)));
router.post('/eventos/:id/conciliar', handle(req => require('../services/speedbox/finanzas').conciliar(req.usuario.id, Number(req.params.id), req.body)));
router.post('/updates', handle(async req => {
  await service.connectionFor(req.usuario.id);
  await events.retryPending();
  await events.pollUpdates();
  return { ok: true };
}));
router.post('/pedidos/:id/enviar', handle(req => service.sendOrder(req.usuario.id, Number(req.params.id))));
router.post('/pedidos/:id/reintentar', handle(async req => {
  if (req.body?.acknowledge_uncertain !== undefined && typeof req.body.acknowledge_uncertain !== 'boolean') {
    throw Object.assign(new Error('Confirmacion de reintento invalida.'), { status: 400 });
  }
  const mapping = await service.sendOrder(req.usuario.id, Number(req.params.id), { retry: true, acknowledgeUncertain: req.body?.acknowledge_uncertain === true });
  return { ok: true, order_id: mapping.order_id, estado: mapping.estado };
}));
module.exports = router;
