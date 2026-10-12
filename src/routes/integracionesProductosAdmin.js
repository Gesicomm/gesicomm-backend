'use strict';

/**
 * Rutas privadas de gestión de API Keys de integración de productos.
 * Montadas en: /api/integraciones/productos
 */
const express = require('express');
const router = express.Router();

const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const { resolverTiendaActiva } = require('../middleware/resolverTiendaActiva');
const ctrl = require('../controllers/integracionProductosAdmin.controller');

router.use(verificarToken);
router.use(verificarPermiso('gestionar_integraciones'));
router.use(resolverTiendaActiva);

router.get('/credenciales', ctrl.listar);
router.post('/credenciales', ctrl.crear);
router.delete('/credenciales/:id', ctrl.revocar);

module.exports = router;
