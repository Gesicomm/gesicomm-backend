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

module.exports = router;
