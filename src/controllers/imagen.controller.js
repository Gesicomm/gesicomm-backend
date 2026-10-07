/**
 * Controller de Imágenes de Productos.
 *
 * POST /api/productos/:id/imagenes         → Subir imagen
 * PUT  /api/productos/:id/imagenes/:imgId  → Actualizar orden/principal/variante
 * DELETE /api/productos/:id/imagenes/:imgId → Eliminar imagen
 */
const path = require('path');
const multer = require('multer');
const { Producto } = require('../models');
const ImagenService = require('../services/imagen.service');
const { R2StorageError } = require('../services/r2/r2.errors');
const { R2ConfigError } = require('../services/r2/r2.config');
const { logger } = require('../utils/logger');
const { destinoUploadsTmp } = require('../utils/uploadTmp');

const storage = multer.diskStorage({
  destination: destinoUploadsTmp,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const MAX_IMAGEN_MB = 5;

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGEN_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const permitidos = ['image/jpeg', 'image/png', 'image/webp'];
    if (!permitidos.includes(file.mimetype)) {
      return cb(new Error('Solo se permiten imágenes JPG, PNG o WebP.'));
    }
    cb(null, true);
  },
});

/**
 * Las imágenes de un Producto son del producto, no de quien las sube: el
 * catálogo es compartido por todo el inquilino, así que cambiarlas se las
 * cambia a cualquier otro comercio que venda lo mismo. Se aplica la misma
 * regla que ProductoService.actualizar — admin, o quien lo creó.
 *
 * Devuelve el producto si puede seguir, o null habiendo ya respondido.
 */
async function productoEditablePorUsuario(req, res) {
  const producto = await Producto.findOne({
    where: { id: req.params.id, inquilino_id: req.usuario.tenantId },
  });
  if (!producto) {
    res.status(404).json({ message: 'Producto no encontrado.' });
    return null;
  }
  const esAdmin = req.usuario.rol === 'administrador';
  if (!esAdmin && producto.creado_por !== req.usuario.id) {
    res.status(403).json({ message: 'No tienes permiso para modificar las imágenes de un producto que no creaste.' });
    return null;
  }
  return producto;
}

function subirImagenMiddleware(req, res, next) {
  upload.single('imagen')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: `La imagen supera el máximo permitido de ${MAX_IMAGEN_MB} MB.` });
    }
    return res.status(400).json({ message: err.message || 'Error al subir la imagen.' });
  });
}

async function subirImagen(req, res) {
  try {
    const { id } = req.params;
    const inquilino_id = req.usuario.tenantId;

    if (!req.file) return res.status(400).json({ message: 'No se recibió ningún archivo.' });

    const producto = await productoEditablePorUsuario(req, res);
    if (!producto) {
      // Ya respondió 404/403. El archivo temporal se borra igual: multer lo
      // dejó escrito en disco antes de llegar hasta acá.
      await ImagenService.borrarArchivoSeguro(req.file.path);
      return;
    }

    const imagen = await ImagenService.subir(id, inquilino_id, req.file, req.body);
    return res.status(201).json(imagen);
  } catch (err) {
    logger.error({
      mensaje: 'Error al procesar imagen de producto',
      producto_id: req.params.id,
      operation: err.operation,
      errorCode: err.code || err.name,
    });
    const status = err instanceof R2StorageError && err.status < 500 ? err.status : 500;
    const message = err instanceof R2ConfigError || err instanceof R2StorageError
      ? 'No se pudo almacenar el archivo.'
      : (err.message || 'Error al procesar la imagen.');
    return res.status(status).json({ message });
  }
}

/**
 * Foto suelta de la ficha del producto (antes/después, opiniones, "por qué
 * elegirnos"…), cargada en Mis Productos → Vista del producto.
 *
 * No es una imagen de la GALERÍA: no crea fila en ProductoImagen ni aparece
 * en las fotos del producto. Solo sube a R2 y devuelve { url }; la URL queda
 * guardada dentro de Producto.ficha_datos cuando el formulario se guarda.
 * Mismo permiso que la galería: admin o quien creó el producto.
 */
async function subirImagenFicha(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: 'No se recibió ningún archivo.' });

    const producto = await productoEditablePorUsuario(req, res);
    if (!producto) {
      await ImagenService.borrarArchivoSeguro(req.file.path);
      return;
    }

    const imagenData = await ImagenService.procesarArchivoParaR2(
      req.file,
      `productos/${producto.id}/ficha`,
      { width: 1600, quality: 82 },
    );
    return res.status(201).json({ url: imagenData.url });
  } catch (err) {
    await ImagenService.borrarArchivoSeguro(req.file?.path);
    logger.error({
      mensaje: 'Error al subir imagen de ficha de producto',
      producto_id: req.params.id,
      operation: err.operation,
      errorCode: err.code || err.name,
    });
    const status = err instanceof R2StorageError && err.status < 500 ? err.status : 500;
    const message = err instanceof R2ConfigError || err instanceof R2StorageError
      ? 'No se pudo almacenar el archivo.'
      : (err.message || 'Error al procesar la imagen.');
    return res.status(status).json({ message });
  }
}

async function actualizarImagen(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    if (!await productoEditablePorUsuario(req, res)) return;
    const imagen = await ImagenService.actualizar(req.params.imgId, req.params.id, inquilino_id, req.body);
    return res.json(imagen);
  } catch (err) {
    logger.error({
      mensaje: 'Error al actualizar imagen de producto',
      producto_id: req.params.id,
      imagen_id: req.params.imgId,
      errorCode: err.code || err.name,
    });
    const status = err.message.includes('no encontrada') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al actualizar imagen.' });
  }
}

async function reprocesarImagen(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    if (!await productoEditablePorUsuario(req, res)) return;
    const imagen = await ImagenService.reprocesar(req.params.imgId, req.params.id, inquilino_id, req.body);
    return res.json(imagen);
  } catch (err) {
    logger.error({
      mensaje: 'Error al reprocesar imagen de producto',
      producto_id: req.params.id,
      imagen_id: req.params.imgId,
      operation: err.operation,
      errorCode: err.code || err.name,
    });
    const status = err.message?.includes('no encontrada') ? 404 : (err.message?.includes('original conservado') ? 409 : 500);
    const message = err instanceof R2StorageError || err instanceof R2ConfigError
      ? 'No se pudo regenerar el archivo.'
      : (err.message || 'Error al reprocesar la imagen.');
    return res.status(status).json({ message });
  }
}

async function eliminarImagen(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    if (!await productoEditablePorUsuario(req, res)) return;
    await ImagenService.eliminar(req.params.imgId, req.params.id, inquilino_id);
    return res.json({ message: 'Imagen eliminada.' });
  } catch (err) {
    logger.error({
      mensaje: 'Error al eliminar imagen de producto',
      producto_id: req.params.id,
      imagen_id: req.params.imgId,
      operation: err.operation,
      errorCode: err.code || err.name,
    });
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ message: err.message });
    }
    const status = err instanceof R2StorageError && err.status < 500 ? err.status : 500;
    const message = err instanceof R2StorageError ? 'No se pudo eliminar el archivo.' : (err.message || 'Error al eliminar imagen.');
    return res.status(status).json({ message });
  }
}

module.exports = { upload, subirImagenMiddleware, subirImagen, subirImagenFicha, actualizarImagen, reprocesarImagen, eliminarImagen };
