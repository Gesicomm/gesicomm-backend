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

module.exports = router;
