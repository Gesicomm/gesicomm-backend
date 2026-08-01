'use strict';

/**
 * Controller privado de Landings — gestión propia del usuario, scopeada
 * por su Tienda (1:1 con Usuario). Todas las acciones primero resuelven
 * la tienda del usuario logueado — sin tienda no hay dónde colgar una
 * landing.
 *
 * GET    /api/mis-landings         → listar mis landings
 * POST   /api/mis-landings         → crear
 * GET    /api/mis-landings/:id     → detalle
 * PUT    /api/mis-landings/:id     → actualizar
 * DELETE /api/mis-landings/:id     → eliminar
 * PATCH  /api/mis-landings/:id/estado → publicar/despublicar
 * POST   /api/mis-landings/:id/banner → subir imagen del banner
 * DELETE /api/mis-landings/:id/banner → quitar imagen del banner
 * POST   /api/mis-landings/:id/seo-imagen → subir imagen OG
 * DELETE /api/mis-landings/:id/seo-imagen → quitar imagen OG
 * GET    /api/mis-landings/:id/estadisticas → visitas/conversaciones/CTR/productos más consultados
 */

const path = require('path');
const multer = require('multer');
const { Tienda } = require('../models');
const LandingService = require('../services/landing.service');
const ImagenService = require('../services/imagen.service');

// Mismo límite y filtro que imagen.controller.js (subida de fotos de
// producto) — instancia propia porque el destino (Landing) es un modelo
// distinto. Se reutiliza tanto para el banner como para la imagen OG: es
// el mismo tipo de subida (una sola imagen, mismo límite), solo cambia a
// qué columna de Landing termina escribiendo.
const UPLOADS_TMP = path.join(process.cwd(), 'tmp', 'uploads');
const MAX_IMAGEN_BYTES = 1 * 1024 * 1024; // 1MB

const uploadImagenLanding = multer({
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

function subirImagenLandingMiddleware(req, res, next) {
  uploadImagenLanding.single('imagen')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'La imagen supera el máximo permitido de 1MB.' });
    }
    return res.status(400).json({ message: err.message || 'Error al subir la imagen.' });
  });
}

function manejarError(res, err, defaultMsg) {
  console.error('[landing]', err.message);
  const status = err.message === 'Landing no encontrada.'
    ? 404
    : (err.errores ? 422 : 400);
  return res.status(status).json({ message: err.message || defaultMsg, errores: err.errores });
}

/** @returns {Promise<import('../models').Tienda|null>} null si ya respondió el error */
async function resolverTiendaPropia(req, res) {
  const tienda = await Tienda.findOne({ where: { usuario_id: req.usuario.id } });
  if (!tienda) {
    res.status(409).json({ message: 'Todavía no tenés una tienda creada. Creála antes de armar una landing.' });
    return null;
  }
  return tienda;
}

async function listar(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const landings = await LandingService.listar(tienda.id);
    return res.json(landings);
  } catch (err) {
    console.error('[landing] listar:', err.message);
    return res.status(500).json({ message: 'Error al listar landings.' });
  }
}

async function crear(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const landing = await LandingService.crear(tienda.id, req.usuario.tenantId, req.body);
    return res.status(201).json(landing);
  } catch (err) {
    return manejarError(res, err, 'Error al crear la landing.');
  }
}

async function detalle(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const landing = await LandingService.obtener(req.params.id, tienda.id);
    return res.json(landing);
  } catch (err) {
    return manejarError(res, err, 'Error al obtener la landing.');
  }
}

async function actualizar(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const landing = await LandingService.actualizar(req.params.id, tienda.id, req.usuario.tenantId, req.body);
    return res.json(landing);
  } catch (err) {
    return manejarError(res, err, 'Error al actualizar la landing.');
  }
}

async function eliminar(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    await LandingService.eliminar(req.params.id, tienda.id);
    return res.json({ message: 'Landing eliminada.' });
  } catch (err) {
    return manejarError(res, err, 'Error al eliminar la landing.');
  }
}

async function cambiarEstado(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const landing = await LandingService.cambiarEstado(req.params.id, tienda.id, !!req.body.activo);
    return res.json(landing);
  } catch (err) {
    return manejarError(res, err, 'Error al cambiar el estado de la landing.');
  }
}

/**
 * Compartido por banner y por imagen OG: sube+redimensiona el archivo y
 * lo cuelga del campo que indique `actualizar` (una de las dos funciones
 * _actualizarImagenCampo de LandingService), borrando la imagen vieja del
 * disco si había una.
 */
async function subirImagenGenerica(req, res, { actualizar, opts, defaultMsg }) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) { await ImagenService.borrarArchivoSeguro(req.file?.path); return; }

    if (!req.file) return res.status(400).json({ message: 'No se recibió ningún archivo.' });

    let url;
    try {
      url = await ImagenService.guardarArchivo(req.file, opts);
    } catch (err) {
      await ImagenService.borrarArchivoSeguro(req.file.path);
      throw err;
    }

    const { landing, anterior } = await actualizar(req.params.id, tienda.id, url);
    if (anterior) {
      await ImagenService.borrarArchivoSeguro(path.join(process.cwd(), 'public', anterior));
    }
    return res.status(201).json(landing);
  } catch (err) {
    return manejarError(res, err, defaultMsg);
  }
}

async function eliminarImagenGenerica(req, res, { quitar, defaultMsg }) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;

    const { landing, anterior } = await quitar(req.params.id, tienda.id);
    if (anterior) {
      await ImagenService.borrarArchivoSeguro(path.join(process.cwd(), 'public', anterior));
    }
    return res.json(landing);
  } catch (err) {
    return manejarError(res, err, defaultMsg);
  }
}

async function subirBanner(req, res) {
  // Banner en formato ancho (hero) — no tiene sentido el mismo recorte de
  // 1200px que una foto de producto cuadrada/vertical.
  return subirImagenGenerica(req, res, {
    actualizar: (id, tiendaId, url) => LandingService.actualizarImagenBanner(id, tiendaId, url),
    opts: { width: 1600, quality: 82 },
    defaultMsg: 'Error al subir la imagen del banner.',
  });
}

async function eliminarBanner(req, res) {
  return eliminarImagenGenerica(req, res, {
    quitar: (id, tiendaId) => LandingService.quitarImagenBanner(id, tiendaId),
    defaultMsg: 'Error al quitar la imagen del banner.',
  });
}

async function subirSeoImagen(req, res) {
  return subirImagenGenerica(req, res, {
    actualizar: (id, tiendaId, url) => LandingService.actualizarImagenSeo(id, tiendaId, url),
    opts: { width: 1200, quality: 82 },
    defaultMsg: 'Error al subir la imagen OG.',
  });
}

async function eliminarSeoImagen(req, res) {
  return eliminarImagenGenerica(req, res, {
    quitar: (id, tiendaId) => LandingService.quitarImagenSeo(id, tiendaId),
    defaultMsg: 'Error al quitar la imagen OG.',
  });
}

async function estadisticas(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const datos = await LandingService.estadisticas(req.params.id, tienda.id, req.query.dias);
    return res.json(datos);
  } catch (err) {
    return manejarError(res, err, 'Error al obtener las estadísticas.');
  }
}

module.exports = {
  listar, crear, detalle, actualizar, eliminar, cambiarEstado,
  subirImagenLandingMiddleware,
  subirBanner, eliminarBanner,
  subirSeoImagen, eliminarSeoImagen,
  estadisticas,
};
