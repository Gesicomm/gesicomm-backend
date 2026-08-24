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

const UPLOADS_TMP = path.join(process.cwd(), 'tmp', 'uploads');
const MAX_IMAGEN_BYTES = 1 * 1024 * 1024; // 1MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_TMP),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGEN_BYTES },
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
      return res.status(413).json({ message: 'La imagen supera el máximo permitido de 1MB.' });
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
    console.error(err);
    return res.status(500).json({ message: err.message || 'Error al procesar la imagen.' });
  }
}

async function actualizarImagen(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    if (!await productoEditablePorUsuario(req, res)) return;
    const imagen = await ImagenService.actualizar(req.params.imgId, req.params.id, inquilino_id, req.body);
    return res.json(imagen);
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrada') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al actualizar imagen.' });
  }
}

async function eliminarImagen(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    if (!await productoEditablePorUsuario(req, res)) return;
    await ImagenService.eliminar(req.params.imgId, req.params.id, inquilino_id);
    return res.json({ message: 'Imagen eliminada.' });
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrada') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al eliminar imagen.' });
  }
}

module.exports = { upload, subirImagenMiddleware, subirImagen, actualizarImagen, eliminarImagen };
