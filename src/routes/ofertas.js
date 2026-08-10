'use strict';

/**
 * Rutas de Ofertas anidadas bajo un producto.
 * Montadas en: /api/productos/:productoId/ofertas
 */
const express = require('express');
const { verificarPermiso } = require('../middleware/autorizacion');
const ofertaCtrl = require('../controllers/oferta.controller');

const router = express.Router({ mergeParams: true });

router.get('/', verificarPermiso('ver_productos'), ofertaCtrl.listarPorProducto);
router.post('/', verificarPermiso('editar_productos'), ofertaCtrl.crear);

module.exports = router;
