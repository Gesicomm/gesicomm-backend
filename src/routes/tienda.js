'use strict';

/**
 * Rutas privadas de Tienda. Montadas en: /api/mi-tienda
 * IMPORTANTE: /subdominio/disponibilidad debe ir ANTES que cualquier ruta
 * con :id para no chocar (acá no hay :id, pero se mantiene el orden por
 * claridad con el resto del código).
 */

const express = require('express');
const multer = require('multer');
const router = express.Router();

const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const { resolverTiendaActiva } = require('../middleware/resolverTiendaActiva');
const ctrl = require('../controllers/tienda.controller');
const { subirImagenMiddleware } = require('../controllers/landingSimple.controller');

const uploadFuente = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const permitido = /\.(woff2|woff|ttf|otf)$/i.test(file.originalname || '');
    if (!permitido) return cb(new Error('Solo se permiten fuentes .woff2, .woff, .ttf u .otf.'));
    cb(null, true);
  },
});

function subirFuenteMiddleware(req, res, next) {
  uploadFuente.single('fuente')(req, res, (err) => {
    if (!err) return next();
    return res.status(400).json({ message: err.message || 'Error al subir la fuente.' });
  });
}

router.use(verificarToken);
router.use(verificarPermiso('gestionar_tienda'));
router.use(resolverTiendaActiva);

router.get('/subdominio/disponibilidad', ctrl.disponibilidadSubdominio);

router.get('/dominio-propio/estado', ctrl.estadoDominioPropio);
router.post('/dominio-propio', ctrl.guardarDominioPropio);
router.patch('/dominio-propio/habilitado', ctrl.habilitacionDominioPropio);
router.delete('/dominio-propio', ctrl.eliminarDominioPropio);

router.post('/dominio/whois', ctrl.whoisDominio);

// Cómo entrega el comercio lo que vende (motor de fulfillment, Fase 3).
router.get('/fulfillment', ctrl.obtenerFulfillment);
router.post('/fulfillment/depositos', ctrl.listarDepositosFulfillment);
router.put('/fulfillment', ctrl.guardarFulfillment);
router.get('/fulfillment/cobertura', ctrl.coberturaGesicomm);

router.post('/logo', subirImagenMiddleware, ctrl.subirLogo);
router.delete('/logo', ctrl.eliminarLogo);
router.post('/favicon', subirImagenMiddleware, ctrl.subirFavicon);
router.delete('/favicon', ctrl.eliminarFavicon);

router.put('/typography', ctrl.guardarTipografia);
router.post('/typography/fonts', subirFuenteMiddleware, ctrl.subirFuente);
router.delete('/typography/fonts/:fontId', ctrl.eliminarFuente);

router.get('/', ctrl.obtener);
router.post('/', ctrl.crear);
router.put('/', ctrl.actualizar);

module.exports = router;
