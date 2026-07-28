'use strict';

/**
 * Rutas de compatibilidad — Combos anidados bajo productos.
 * Montadas en: /api/productos/:productoId/combos
 *
 * @deprecated Usar /api/combos para la sección administrativa completa.
 * Mantenidas para no romper referencias existentes.
 */
const express = require('express');
const comboController = require('../controllers/combo.controller');

const router = express.Router({ mergeParams: true });

router.get('/', comboController.listarPorProducto);

module.exports = router;
