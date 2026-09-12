'use strict';

/**
 * Controller de Ofertas comerciales.
 *
 * GET    /api/productos/:productoId/ofertas → Listar ofertas de un producto
 * POST   /api/productos/:productoId/ofertas → Crear oferta
 * PUT    /api/ofertas/:id                   → Actualizar oferta
 * DELETE /api/ofertas/:id                   → Baja lógica (activo=false)
 * POST   /api/ofertas/:id/imagen            → Subir/reemplazar su imagen
 * DELETE /api/ofertas/:id/imagen            → Quitarla (vuelve a la del producto)
 */

const path = require('path');
const multer = require('multer');
const { sequelize } = require('../models');
const OfertaService = require('../services/oferta.service');
const ImagenService = require('../services/imagen.service');
const { rollbackSeguro } = require('../utils/transaction');

// Mismo límite y filtro que imagen.controller.js y landing.controller.js.
// Instancia propia porque el destino es otro modelo, no porque el criterio
// cambie: si algún día cambia el límite, cambia en los tres.
const UPLOADS_TMP = path.join(process.cwd(), 'tmp', 'uploads');
const MAX_IMAGEN_BYTES = 1 * 1024 * 1024; // 1MB

const uploadImagenOferta = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_TMP),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: MAX_IMAGEN_BYTES },
  fileFilter: (req, file, cb) => {
    const permitidos = ['image/jpeg', 'image/png', 'image/webp'];
    if (!permitidos.includes(file.mimetype)) {
      return cb(new Error('Solo se permiten imágenes JPG, PNG o WebP.'));
    }
    cb(null, true);
  },
});

function subirImagenMiddleware(req, res, next) {
  uploadImagenOferta.single('imagen')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'La imagen supera el máximo permitido de 1MB.' });
    }
    return res.status(400).json({ message: err.message || 'Error al subir la imagen.' });
  });
}

async function subirImagen(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: 'No se recibió ningún archivo.' });

    let imagenData;
    try {
      imagenData = await ImagenService.procesarArchivoParaR2(req.file, `offers/${req.params.id}`, { width: 800 });
    } catch (err) {
      console.error('[oferta] subirImagen:', err.message);
      return res.status(500).json({ message: 'No se pudo procesar la imagen.' });
    }

    const { imagen_url, anterior } = await OfertaService.actualizarImagen(
      Number(req.params.id), req.usuario.tenantId, imagenData
    );
    // Reemplazar es subir la nueva y borrar la vieja: si no, cada cambio de
    // foto deja un objeto huérfano en R2 para siempre.
    if (anterior) await ImagenService.eliminarObjetoStorage(anterior);
    return res.status(201).json({ imagen_url });
  } catch (err) {
    console.error('[oferta] subirImagen:', err.message);
    const status = err.message === 'Oferta no encontrada.' ? 404 : 400;
    return res.status(status).json({ message: err.message || 'Error al subir la imagen.' });
  }
}

async function quitarImagen(req, res) {
  try {
    const { anterior } = await OfertaService.actualizarImagen(
      Number(req.params.id), req.usuario.tenantId, null
    );
    if (anterior) await ImagenService.eliminarObjetoStorage(anterior);
    return res.json({ imagen_url: null });
  } catch (err) {
    console.error('[oferta] quitarImagen:', err.message);
    const status = err.message === 'Oferta no encontrada.' ? 404 : 400;
    return res.status(status).json({ message: err.message || 'Error al quitar la imagen.' });
  }
}

async function listarPorProducto(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    // ?soloActivas=true — la baja de una oferta es lógica (activo=false), así
    // que sin esto quien la acaba de borrar la sigue viendo en la lista y
    // parece que el borrado no hizo nada. La pantalla de administración de
    // ofertas sí las quiere todas (muestra un badge "Inactivo"), por eso es
    // opt-in y no el comportamiento por defecto.
    const soloActivas = req.query.soloActivas === 'true';
    const ofertas = await OfertaService.listarPorProducto(req.params.productoId, inquilino_id, { soloActivas });
    return res.json(ofertas);
  } catch (err) {
    console.error('[oferta] listarPorProducto:', err.message);
    return res.status(500).json({ message: 'Error al listar las ofertas.' });
  }
}

async function crear(req, res) {
  const t = await sequelize.transaction();
  try {
    const inquilino_id = req.usuario.tenantId;
    const oferta = await OfertaService.crear(req.params.productoId, req.body, inquilino_id, t);
    await t.commit();
    return res.status(201).json(oferta);
  } catch (err) {
    await rollbackSeguro(t);
    console.error('[oferta] crear:', err.message);
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(422).json({ message: 'Ya existe una oferta con ese código.' });
    }
    return res.status(400).json({ message: err.message || 'Error al crear la oferta.' });
  }
}

async function actualizar(req, res) {
  const t = await sequelize.transaction();
  try {
    const inquilino_id = req.usuario.tenantId;
    const oferta = await OfertaService.actualizar(Number(req.params.id), req.body, inquilino_id, t);
    await t.commit();
    return res.json(oferta);
  } catch (err) {
    await rollbackSeguro(t);
    console.error('[oferta] actualizar:', err.message);
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(422).json({ message: 'Ya existe una oferta con ese código.' });
    }
    const status = err.message === 'Oferta no encontrada.' ? 404 : 400;
    return res.status(status).json({ message: err.message || 'Error al actualizar la oferta.' });
  }
}

async function eliminar(req, res) {
  const t = await sequelize.transaction();
  try {
    const inquilino_id = req.usuario.tenantId;
    await OfertaService.eliminar(Number(req.params.id), inquilino_id, t);
    await t.commit();
    return res.json({ success: true });
  } catch (err) {
    await rollbackSeguro(t);
    console.error('[oferta] eliminar:', err.message);
    const status = err.message === 'Oferta no encontrada.' ? 404 : 400;
    return res.status(status).json({ message: err.message || 'Error al eliminar la oferta.' });
  }
}

module.exports = {
  listarPorProducto, crear, actualizar, eliminar,
  subirImagenMiddleware, subirImagen, quitarImagen,
};
