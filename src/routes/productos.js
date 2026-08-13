/**
 * Rutas de Productos e Imágenes.
 */
const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const ctrl = require('../controllers/producto.controller');
const imgCtrl = require('../controllers/imagen.controller');
const comboRoutes = require('./combos');
const ofertaRoutes = require('./ofertas');
const landingCtrl = require('../controllers/landing.controller');

router.use(verificarToken);

// Productos
router.post('/buscar', verificarPermiso('ver_productos'), ctrl.buscar);
router.post('/', verificarPermiso('crear_productos'), ctrl.crear);
router.get('/:id', verificarPermiso('ver_productos'), ctrl.detalle);
router.get('/:id/historial-precios', verificarPermiso('ver_productos'), ctrl.historialPrecios);
router.get('/:id/variantes', verificarPermiso('ver_productos'), ctrl.variantes);
router.get('/:id/imagenes', verificarPermiso('ver_productos'), ctrl.imagenes);
router.put('/:id', verificarPermiso('editar_productos'), ctrl.actualizar);
router.delete('/:id', verificarPermiso('eliminar_productos'), ctrl.eliminar);

// Imágenes de un producto
router.post('/:id/imagenes', verificarPermiso('editar_productos'), imgCtrl.subirImagenMiddleware, imgCtrl.subirImagen);
router.put('/:id/imagenes/:imgId', verificarPermiso('editar_productos'), imgCtrl.actualizarImagen);
router.delete('/:id/imagenes/:imgId', verificarPermiso('eliminar_productos'), imgCtrl.eliminarImagen);

// Combos
router.use('/:productoId/combos', comboRoutes);

// Ofertas comerciales
router.use('/:productoId/ofertas', ofertaRoutes);

// Diseño de página propio del producto (page-builder) — mismo permiso que
// el resto del armador de landings, no editar_productos: es contenido
// visual de la vidriera, no un dato del catálogo.
router.get('/:id/pagina-secciones', verificarPermiso('gestionar_landing'), landingCtrl.seccionesProducto);
router.put('/:id/pagina-secciones', verificarPermiso('gestionar_landing'), landingCtrl.guardarSeccionesProducto);

module.exports = router;
