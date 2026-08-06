'use strict';

/**
 * Rutas privadas de Landings — gestión propia del usuario.
 * Montadas en: /api/mis-landings
 */

const express = require('express');
const router = express.Router();

const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const ctrl = require('../controllers/landing.controller');

router.use(verificarToken);
router.use(verificarPermiso('gestionar_landing'));

router.get('/', ctrl.listar);
router.post('/', ctrl.crear);
router.get('/:id', ctrl.detalle);
router.put('/:id', ctrl.actualizar);
router.delete('/:id', ctrl.eliminar);
router.patch('/:id/estado', ctrl.cambiarEstado);
router.post('/:id/banner', ctrl.subirImagenLandingMiddleware, ctrl.subirBanner);
router.delete('/:id/banner', ctrl.eliminarBanner);
router.post('/:id/seo-imagen', ctrl.subirImagenLandingMiddleware, ctrl.subirSeoImagen);
router.delete('/:id/seo-imagen', ctrl.eliminarSeoImagen);
router.post('/:id/testimonio-foto', ctrl.subirImagenLandingMiddleware, ctrl.subirTestimonioFoto);
router.get('/:id/estadisticas', ctrl.estadisticas);
router.post('/:id/estadisticas-rango', ctrl.estadisticasRango);

module.exports = router;
