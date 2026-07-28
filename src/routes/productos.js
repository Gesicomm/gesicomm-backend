/**
 * Rutas de Productos e Imágenes.
 */
const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const ctrl = require('../controllers/producto.controller');
const imgCtrl = require('../controllers/imagen.controller');

router.use(verificarToken);

// Productos
router.post('/buscar', ctrl.buscar);
router.post('/', ctrl.crear);
router.get('/:id', ctrl.detalle);
router.put('/:id', ctrl.actualizar);
router.delete('/:id', ctrl.eliminar);

// Imágenes de un producto
router.post('/:id/imagenes', imgCtrl.upload.single('imagen'), imgCtrl.subirImagen);
router.put('/:id/imagenes/:imgId', imgCtrl.actualizarImagen);
router.delete('/:id/imagenes/:imgId', imgCtrl.eliminarImagen);

module.exports = router;
