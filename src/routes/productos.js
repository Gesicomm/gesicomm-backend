/**
 * Rutas de Productos e Imágenes.
 */
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const { resolverTiendaActiva } = require('../middleware/resolverTiendaActiva');
const ctrl = require('../controllers/producto.controller');
const imgCtrl = require('../controllers/imagen.controller');
const comboRoutes = require('./combos');
const ofertaRoutes = require('./ofertas');
const landingCtrl = require('../controllers/landing.controller');

const uploadImportacion = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const nombre = String(file.originalname || '').toLowerCase();
    if (nombre.endsWith('.csv') || nombre.endsWith('.xlsx') || nombre.endsWith('.xls')) {
      return cb(null, true);
    }
    return cb(new Error('Solo se permiten archivos CSV o Excel exportados desde Shopify.'));
  },
});

function subirArchivoImportacion(req, res, next) {
  uploadImportacion.single('archivo')(req, res, (err) => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ message: err.message || 'No se pudo leer el archivo.' });
  });
}

router.use(verificarToken);
router.use(resolverTiendaActiva);

// Productos
router.post('/buscar', verificarPermiso('ver_productos'), ctrl.buscar);
router.post('/importar-shopify', verificarPermiso('crear_productos'), subirArchivoImportacion, ctrl.importarShopify);
router.post('/', verificarPermiso('crear_productos'), ctrl.crear);
router.get('/:id', verificarPermiso('ver_productos'), ctrl.detalle);
router.get('/:id/historial-precios', verificarPermiso('ver_productos'), ctrl.historialPrecios);
router.get('/:id/variantes', verificarPermiso('ver_productos'), ctrl.variantes);
router.get('/:id/opciones', verificarPermiso('ver_productos'), ctrl.opciones);
router.get('/:id/imagenes', verificarPermiso('ver_productos'), ctrl.imagenes);
router.get('/:id/faq', verificarPermiso('ver_productos'), ctrl.faq);
router.get('/:id/relacionados', verificarPermiso('ver_productos'), ctrl.relacionados);
// Simulador de precio (tab Precios/Ofertas) — solo lectura, mismo permiso
// que ver el producto.
router.post('/:id/simular-precio', verificarPermiso('ver_productos'), ctrl.simularPrecio);
router.put('/:id', verificarPermiso('editar_productos'), ctrl.actualizar);
router.delete('/:id', verificarPermiso('eliminar_productos'), ctrl.eliminar);

// Imágenes de un producto
router.post('/:id/imagenes', verificarPermiso('editar_productos'), imgCtrl.subirImagenMiddleware, imgCtrl.subirImagen);
// Fotos de la ficha (Vista del producto): sube a R2 y devuelve { url }, sin tocar la galería.
router.post('/:id/ficha-imagen', verificarPermiso('editar_productos'), imgCtrl.subirImagenMiddleware, imgCtrl.subirImagenFicha);
router.put('/:id/imagenes/:imgId', verificarPermiso('editar_productos'), imgCtrl.actualizarImagen);
router.post('/:id/imagenes/:imgId/reprocesar', verificarPermiso('editar_productos'), imgCtrl.reprocesarImagen);
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
