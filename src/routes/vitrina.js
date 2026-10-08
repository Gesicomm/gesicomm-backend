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
const { resolverTiendaActiva } = require('../middleware/resolverTiendaActiva');
const ctrl = require('../controllers/precioUsuario.controller');
const preciosCtrl = require('../controllers/precioUsuarioMasivo.controller');

router.use(verificarToken);
router.use(resolverTiendaActiva);

router.get('/catalogo', verificarPermiso('ver_productos'), ctrl.catalogo);
router.post('/catalogo-paginado', verificarPermiso('ver_productos'), ctrl.catalogoPaginado);

router.post('/precios/buscar', verificarPermiso('ver_productos'), preciosCtrl.buscar);
router.post('/precios/actualizar', verificarPermiso('gestionar_precio_propio'), preciosCtrl.actualizar);

router.put('/productos/:id/precio', verificarPermiso('gestionar_precio_propio'), ctrl.guardarPrecioProducto);
router.post('/productos/categorizar', verificarPermiso('gestionar_precio_propio'), ctrl.categorizarProductos);
router.put('/combos/:id/precio', verificarPermiso('gestionar_precio_propio'), ctrl.guardarPrecioCombo);

router.get('/productos/:id/sensibilidad', verificarPermiso('ver_analisis_sensibilidad'), ctrl.sensibilidadProducto);
router.get('/combos/:id/sensibilidad', verificarPermiso('ver_analisis_sensibilidad'), ctrl.sensibilidadCombo);

module.exports = router;
