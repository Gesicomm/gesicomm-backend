'use strict';

/**
 * Rutas privadas de "Landing simple" (3 templates rígidos).
 * Montadas en: /api/mis-landings-simples
 */

const express = require('express');
const router = express.Router();

const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const ctrl = require('../controllers/landingSimple.controller');

router.use(verificarToken);
router.use(verificarPermiso('gestionar_landing'));

router.get('/', ctrl.listar);
router.post('/', ctrl.crear);
// Antes de '/:id' no hace falta (aquel es GET), pero se declara junto al
// otro POST de creación para que el par se lea de una.
router.post('/onboarding', ctrl.crearDesdeOnboarding);
router.post('/ai-draft', ctrl.crearDesdeIA);
router.post('/:id/ai-regenerar', ctrl.regenerarConIA);
router.post('/lienzo-blanco', ctrl.crearLienzoBlanco);
router.get('/:id', ctrl.detalle);
router.put('/:id', ctrl.actualizar);
router.delete('/:id', ctrl.eliminar);
router.patch('/:id/estado', ctrl.cambiarEstado);
router.post('/:id/logo', ctrl.subirImagenMiddleware, ctrl.subirLogo);
router.delete('/:id/logo', ctrl.eliminarLogo);
router.post('/:id/hero-imagen', ctrl.subirImagenMiddleware, ctrl.subirHeroImagen);
router.delete('/:id/hero-imagen', ctrl.eliminarHeroImagen);

module.exports = router;
