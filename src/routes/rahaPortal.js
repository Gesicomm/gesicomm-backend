'use strict';
// Portal externo de Raha: /raha/login en el frontend.
// Sesion propia (Bearer token con tipo 'raha_portal'), independiente de la
// sesion de Gesicom. Raha solo ve solicitudes ya enviadas por los comercios.
const express = require('express');
const rateLimit = require('express-rate-limit');
const service = require('../services/raha/service');
const { enviarExpediente } = require('../services/raha/dossier');
const router = express.Router();
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
const handle = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
const json = fn => handle(async (req, res) => res.json(await fn(req)));
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
router.param('id', (req, res, next) => validId(req.params.id) ? next() : res.status(400).json({ message: 'ID invalido.' }));
router.param('docId', (req, res, next) => validId(req.params.docId) ? next() : res.status(400).json({ message: 'ID invalido.' }));

const limiteLogin = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { message: 'Demasiados intentos. Intenta mas tarde.' } });
router.post('/login', limiteLogin, json(req => service.portalLogin(req.body)));

async function autenticar(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return res.status(401).json({ message: 'No autenticado.' });
    req.rahaUsuario = await service.portalVerify(header.slice(7));
    next();
  } catch (error) { next(error); }
}
router.use(autenticar);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false, message: { message: 'Demasiadas operaciones. Intenta mas tarde.' } }));
router.get('/me', (req, res) => res.json({ usuario: req.rahaUsuario }));
// Filtros dinamicos por body (POST), segun la convencion del proyecto.
router.post('/solicitudes', json(req => service.portalList(req.body || {})));
router.get('/solicitudes/:id', json(req => service.portalDetail(Number(req.params.id))));
router.post('/solicitudes/:id/resolver', json(req => service.portalResolve(req.rahaUsuario, Number(req.params.id), req.body)));
router.get('/solicitudes/:id/documentos/:docId', handle(async (req, res) => {
  const { doc, buffer } = await service.portalDocument(Number(req.params.id), Number(req.params.docId));
  res.set('X-Content-Type-Options', 'nosniff');
  res.attachment(doc.nombre).type(doc.mime).send(buffer);
}));
router.get('/solicitudes/:id/expediente', handle(async (req, res) => {
  await enviarExpediente(res, await service.portalDossier(Number(req.params.id)));
}));
module.exports = router;
