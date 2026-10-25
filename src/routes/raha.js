'use strict';
const express = require('express');
const multer = require('multer');
const { enviarExpediente } = require('../services/raha/dossier');
const { verificarToken } = require('../middleware/autenticacion');
const { resolverTiendaActiva } = require('../middleware/resolverTiendaActiva');
const service = require('../services/raha/service');
const operaciones = require('../services/raha/operaciones');
const router = express.Router();
router.use(verificarToken);
router.use(resolverTiendaActiva);
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
router.use(require('express-rate-limit')({ windowMs: 15 * 60 * 1000, max: 120, message: { message: 'Demasiadas operaciones. Intenta mas tarde.' } }));
router.param('id', (req, res, next) => {
  if (!Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) <= 0) return res.status(400).json({ message: 'ID invalido.' });
  next();
});
const handle = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
const json = fn => handle(async (req, res) => res.json(await fn(req)));
const { MAX_SIZE } = require('../services/raha/storage');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SIZE, files: 1, fields: 2, fieldSize: 100 } }).single('archivo');
router.get('/', json(req => service.status(req.usuario)));
router.get('/operaciones/destinos', json(() => operaciones.destinos()));
router.get('/operaciones/origenes', json(req => operaciones.origenes(req.usuario)));
router.post('/operaciones/stock', json(req => operaciones.stock(req.usuario, req.body || {})));
router.post('/operaciones/envios/listado', json(req => operaciones.listarEnvios(req.usuario, req.body || {})));
router.post('/operaciones/envios', json(req => operaciones.crearEnvio(req.usuario, req.body)));
router.get('/operaciones/envios/:id', json(req => operaciones.detalleEnvio(req.usuario, Number(req.params.id))));
router.post('/operaciones/envios/:id/resolver', json(req => operaciones.resolverEnvio(req.usuario, Number(req.params.id), req.body)));
router.put('/', json(req => service.save(req.usuario, req.body)));
router.get('/contrato', handle(async (req, res) => {
  const buffer = await service.contrato(req.usuario);
  res.attachment('contrato-marco-raha.docx').type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').send(buffer);
}));
router.post('/enviar', json(req => service.submit(req.usuario, req.body)));
router.post('/documentos', (req, res, next) => upload(req, res, error => {
  if (!error) return next();
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      code: 'FILE_TOO_LARGE', maxSizeBytes: MAX_SIZE,
      message: 'El archivo es demasiado pesado. El máximo permitido es de 8 MB por documento. Reducí su tamaño o comprimilo y volvé a intentar.',
    });
  }
  return res.status(400).json({ message: 'No se pudo recibir el documento. Adjuntá un solo archivo PDF, JPG, PNG o WebP de hasta 8 MB.' });
}),
  json(req => service.upload(req.usuario, req.body.tipo, req.body.version, req.file)));
router.delete('/documentos/:id', json(req => service.remove(req.usuario, Number(req.params.id), req.body.version)));
router.get('/documentos/:id', handle(async (req, res) => {
  const { doc, buffer } = await service.document(req.usuario, Number(req.params.id));
  res.set('X-Content-Type-Options', 'nosniff');
  res.attachment(doc.nombre).type(doc.mime).send(buffer);
}));
router.get('/admin', json(req => service.list(req.usuario, req.query)));
// Cuentas del portal externo de Raha (las activa un admin de Gesicom).
// Van antes de '/admin/:id' para que 'portal-usuarios' no se tome como id.
router.get('/admin/portal-usuarios', json(req => service.listPortalUsers(req.usuario)));
router.post('/admin/portal-usuarios', json(req => service.createPortalUser(req.usuario, req.body)));
router.patch('/admin/portal-usuarios/:id', json(req => service.updatePortalUser(req.usuario, Number(req.params.id), req.body)));
router.get('/admin/:id', json(req => service.detail(req.usuario, Number(req.params.id))));
router.post('/admin/:id/revisar', json(req => service.review(req.usuario, Number(req.params.id), req.body)));
router.get('/admin/:id/expediente', handle(async (req, res) => {
  await enviarExpediente(res, await service.dossier(req.usuario, Number(req.params.id)));
}));
module.exports = router;
