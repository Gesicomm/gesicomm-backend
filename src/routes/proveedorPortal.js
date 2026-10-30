'use strict';

const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const { verificarToken } = require('../middleware/autenticacion');
const { validar } = require('../middleware/validacion');
const { asyncHandler } = require('../utils/asyncHandler');
const { auditoria } = require('../utils/logger');
const Portal = require('../services/proveedorPortal.service');
const Documentos = require('../services/proveedorDocumentos.service');
const { CATEGORIAS } = require('../services/solicitudProveedor.service');

const router = express.Router();
router.use(verificarToken);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const idValido = (req, res, next) => /^[1-9]\d*$/.test(req.params.id) && Number.isSafeInteger(Number(req.params.id))
  ? next() : res.status(400).json({ message: 'ID inválido.' });
const imagen = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) }).single('imagen');
const recibirImagen = (req, res, next) => imagen(req, res, err => err
  ? res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'La imagen puede pesar hasta 5 MB.' : 'Subí un JPG, PNG o WebP.' }) : next());
const documento = multer({ storage: multer.memoryStorage(), limits: { fileSize: Documentos.MAX_SIZE, files: 1 } }).single('archivo');
const recibirDocumento = (req, res, next) => documento(req, res, err => err
  ? res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'El documento puede pesar hasta 8 MB.' : 'No pudimos leer el archivo.' }) : next());
async function propiaPostulacion(req) {
  const cuenta = await Portal.cuenta(req.usuario.id);
  if (!cuenta.rolProveedor || !cuenta.postulacion) throw Object.assign(new Error('Activá tu espacio y completá tu postulación.'), { status: 403 });
  return cuenta.postulacion;
}

router.get('/estado', asyncHandler(async (req, res) => res.json(await Portal.estado(req.usuario.id))));
router.post('/activar', asyncHandler(async (req, res) => res.json(await Portal.activar(req.usuario.id))));
router.get('/documentos/:tipo', asyncHandler(async (req, res) => {
  const postulacion = await propiaPostulacion(req);
  const doc = await Documentos.leerDocumento(postulacion.id, req.params.tipo);
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Disposition', `attachment; filename="${doc.nombre}"`);
  res.type(doc.mime).send(doc.body);
}));
router.post('/documentos/cedula', recibirDocumento, asyncHandler(async (req, res) => {
  const postulacion = await propiaPostulacion(req);
  const documentos = await Documentos.guardarDocumento(postulacion.id, 'cedula', req.file);
  auditoria('PROVEEDOR_CEDULA_ADJUNTADA', { solicitudId: postulacion.id, usuarioId: req.usuario.id });
  res.json({ documentos });
}));
router.post('/documentos/contrato-firmado', recibirDocumento, asyncHandler(async (req, res) => {
  const postulacion = await propiaPostulacion(req);
  const documentos = await Documentos.guardarDocumento(postulacion.id, 'contrato_firmado', req.file);
  auditoria('PROVEEDOR_CONTRATO_FIRMADO_ADJUNTADO', { solicitudId: postulacion.id, usuarioId: req.usuario.id });
  res.json({ documentos });
}));
router.get('/servicios', asyncHandler(async (req, res) => res.json({ servicios: await Portal.listar(req.usuario.id) })));
router.post('/servicios', asyncHandler(async (req, res) => res.status(201).json({ servicio: await Portal.crear(req.usuario.id) })));
router.get('/servicios/:id', idValido, asyncHandler(async (req, res) => res.json({ servicio: await Portal.propio(req.usuario.id, Number(req.params.id)) })));
router.patch('/servicios/:id', idValido, validar(z.object({
  categoria: z.enum(Object.keys(CATEGORIAS)), titulo: z.string().trim().max(120),
  resumen: z.string().trim().max(500), detalle_html: z.string().max(30000),
  beneficios: z.array(z.string().trim().max(150)).max(12),
  video_urls: z.array(z.string().trim().max(250)).max(4),
  imagenes: z.array(z.object({ storage_key: z.string().min(1).max(300), alt: z.string().max(120) })).max(6),
  estado: z.enum(['borrador', 'publicado']),
})), asyncHandler(async (req, res) => res.json({ servicio: await Portal.guardar(req.usuario.id, Number(req.params.id), req.body) })));
router.post('/servicios/:id/imagenes', idValido, recibirImagen, asyncHandler(async (req, res) => res.status(201).json({ imagen: await Portal.subirImagen(req.usuario.id, Number(req.params.id), req.file) })));
router.delete('/servicios/:id/imagenes', idValido, validar(z.object({ storage_key: z.string().min(1).max(300) })),
  asyncHandler(async (req, res) => res.json({ servicio: await Portal.quitarImagen(req.usuario.id, Number(req.params.id), req.body.storage_key) })));

module.exports = router;
