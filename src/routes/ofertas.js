'use strict';

/**
 * Rutas de Ofertas anidadas bajo un producto.
 * Montadas en: /api/productos/:productoId/ofertas
 */
const express = require('express');
const { verificarPermiso } = require('../middleware/autorizacion');
const ofertaCtrl = require('../controllers/oferta.controller');

const router = express.Router({ mergeParams: true });

router.post('/buscar', verificarPermiso('ver_productos'), ofertaCtrl.listarPorProducto);
router.post('/', verificarPermiso('editar_productos'), ofertaCtrl.crear);
router.put('/:id', verificarPermiso('editar_productos'), ofertaCtrl.actualizar);
router.delete('/:id', verificarPermiso('editar_productos'), ofertaCtrl.eliminar);
router.post('/:id/imagen', verificarPermiso('editar_productos'), ofertaCtrl.subirImagenMiddleware, ofertaCtrl.subirImagen);
router.delete('/:id/imagen', verificarPermiso('editar_productos'), ofertaCtrl.quitarImagen);

module.exports = router;
