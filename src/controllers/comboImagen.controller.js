'use strict';

const path = require('path');
const multer = require('multer');
const ImagenService = require('../services/imagen.service');
const { ProductoCombo } = require('../models');
const ComboService = require('../services/combo.service');
const { handleR2Error } = require('../services/r2/r2.errors');

const MAX_IMAGEN_BYTES = 5 * 1024 * 1024; // 5MB por imagen

const storage = multer.diskStorage({
  destination: path.join(process.cwd(), 'tmp'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `combo-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGEN_BYTES },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(new Error('Formato no soportado. Usá JPG, PNG o WEBP.'));
    }
    cb(null, true);
  },
});

async function obtenerCombo(req) {
  return ProductoCombo.findOne({
    where: {
      id: req.params.id,
      inquilino_id: req.usuario.tenantId,
      ...ComboService.alcance({ usuario_id: req.usuario.id, esAdmin: req.usuario.rol === 'administrador' }),
    },
  });
}

async function listarImagenes(req, res) {
  try {
    const combo = await obtenerCombo(req);
    if (!combo) return res.status(404).json({ message: 'Combo no encontrado.' });
    const imagenes = await ImagenService.listarPorCombo(combo.id, req.usuario.tenantId);
    res.json(imagenes);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Error al listar imágenes del combo.' });
  }
}

async function subirImagen(req, res) {
  try {
    const combo = await obtenerCombo(req);
    if (!combo) {
      await ImagenService.borrarArchivoSeguro(req.file?.path);
      return res.status(404).json({ message: 'Combo no encontrado.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No se recibió ninguna imagen.' });
    }

    const imagen = await ImagenService.subirCombo(combo.id, req.usuario.tenantId, req.file, req.body);
    res.status(201).json(imagen);
  } catch (err) {
    await ImagenService.borrarArchivoSeguro(req.file?.path);
    if (err.code && String(err.code).startsWith('R2_')) {
      return handleR2Error(res, err);
    }
    res.status(400).json({ message: err.message || 'Error al subir imagen del combo.' });
  }
}

async function actualizarImagen(req, res) {
  try {
    const combo = await obtenerCombo(req);
    if (!combo) return res.status(404).json({ message: 'Combo no encontrado.' });
    const imagen = await ImagenService.actualizarCombo(req.params.imgId, combo.id, req.usuario.tenantId, req.body);
    res.json(imagen);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Error al actualizar imagen del combo.' });
  }
}

async function eliminarImagen(req, res) {
  try {
    const combo = await obtenerCombo(req);
    if (!combo) return res.status(404).json({ message: 'Combo no encontrado.' });
    await ImagenService.eliminarCombo(req.params.imgId, combo.id, req.usuario.tenantId);
    res.json({ ok: true });
  } catch (err) {
    if (err.code && String(err.code).startsWith('R2_')) {
      return handleR2Error(res, err);
    }
    res.status(400).json({ message: err.message || 'Error al eliminar imagen del combo.' });
  }
}

const subirImagenMiddleware = (req, res, next) => {
  upload.single('imagen')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'La imagen supera el máximo permitido de 5MB.' });
    }
    return res.status(400).json({ message: err.message });
  });
};

module.exports = { upload, subirImagenMiddleware, listarImagenes, subirImagen, actualizarImagen, eliminarImagen };
