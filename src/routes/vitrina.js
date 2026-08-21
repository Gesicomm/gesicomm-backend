'use strict';

/**
 * Rutas de la Vitrina del usuario — catálogo de solo-lectura (productos +
 * combos activos) con precio propio editable por el rol 'usuario'.
 * Montadas en: /api/vitrina
 */

const express = require('express');
const router = express.Router();

const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const ctrl = require('../controllers/precioUsuario.controller');

router.use(verificarToken);

router.get('/catalogo', verificarPermiso('ver_productos'), ctrl.catalogo);
router.post('/catalogo-paginado', verificarPermiso('ver_productos'), ctrl.catalogoPaginado);

router.put('/productos/:id/precio', verificarPermiso('gestionar_precio_propio'), ctrl.guardarPrecioProducto);
router.put('/combos/:id/precio', verificarPermiso('gestionar_precio_propio'), ctrl.guardarPrecioCombo);

router.get('/productos/:id/sensibilidad', verificarPermiso('ver_analisis_sensibilidad'), ctrl.sensibilidadProducto);
router.get('/combos/:id/sensibilidad', verificarPermiso('ver_analisis_sensibilidad'), ctrl.sensibilidadCombo);

module.exports = router;
