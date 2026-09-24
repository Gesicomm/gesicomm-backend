'use strict';

/**
 * Rutas administrativas de Ofertas por id (fuera del anidado por producto).
 * Montadas en: /api/ofertas
 */
const express = require('express');
const router = express.Router();

const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const ofertaCtrl = require('../controllers/oferta.controller');

router.use(verificarToken);

// Todas las ofertas del inquilino (filtrables por estrategia/producto): el
// armador de landing las pide de una vez en vez de producto por producto.
router.get('/', verificarPermiso('ver_productos'), ofertaCtrl.listar);
router.put('/:id', verificarPermiso('editar_productos'), ofertaCtrl.actualizar);
router.delete('/:id', verificarPermiso('editar_productos'), ofertaCtrl.eliminar);

// Imagen propia de la oferta (una sola). Se administra tanto desde la carga
// de productos como desde el armador de landing — por eso vive acá, en las
// rutas por id de oferta, y no anidada bajo el producto.
router.post('/:id/imagen', verificarPermiso('editar_productos'), ofertaCtrl.subirImagenMiddleware, ofertaCtrl.subirImagen);
router.delete('/:id/imagen', verificarPermiso('editar_productos'), ofertaCtrl.quitarImagen);

module.exports = router;
