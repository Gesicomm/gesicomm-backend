'use strict';

/**
 * Rutas privadas de EMBUDOS (funnels).
 * Montadas en: /api/mis-funnels
 */

const express = require('express');
const router = express.Router();

const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const ctrl = require('../controllers/funnel.controller');

router.use(verificarToken);
router.use(verificarPermiso('gestionar_landing'));

// Antes de "/:id" — si no, Express matchea "templates" y "producto" como id.
router.get('/templates', ctrl.listarTemplates);
router.get('/producto/:productoId', ctrl.porProducto);

router.get('/', ctrl.listar);
router.post('/', ctrl.crear);
router.get('/:id', ctrl.detalle);
router.put('/:id', ctrl.actualizar);
router.delete('/:id', ctrl.eliminar);
router.patch('/:id/estado', ctrl.cambiarEstado);

module.exports = router;
