'use strict';

/**
 * Controller privado de "Landing simple" (3 templates rígidos) — mismo
 * patrón de landing.controller.js (resuelve la tienda propia del usuario
 * antes de cualquier acción), pero acotado al modo rígido.
 *
 * GET    /api/mis-landings-simples          → listar mis landings rígidas
 * POST   /api/mis-landings-simples          → crear desde un template rígido
 * POST   /api/mis-landings-simples/lienzo-blanco → crear una landing de código
 * GET    /api/mis-landings-simples/:id      → detalle
 * PUT    /api/mis-landings-simples/:id      → actualizar contenido permitido
 * DELETE /api/mis-landings-simples/:id      → eliminar
 * PATCH  /api/mis-landings-simples/:id/estado → publicar/despublicar
 * POST   /api/mis-landings-simples/:id/logo → subir logo
 * DELETE /api/mis-landings-simples/:id/logo → quitar logo
 * POST   /api/mis-landings-simples/:id/hero-imagen → subir imagen del hero
 * DELETE /api/mis-landings-simples/:id/hero-imagen → quitar imagen del hero
 */

const path = require('path');
const multer = require('multer');
const { Tienda } = require('../models');
const LandingSimpleService = require('../services/landingSimple.service');
const ImagenService = require('../services/imagen.service');
const AuthTracking = require('../services/authTracking.service');

const UPLOADS_TMP = path.join(process.cwd(), 'tmp', 'uploads');
const MAX_IMAGEN_BYTES = 1 * 1024 * 1024; // 1MB, mismo límite que landing.controller.js

const uploadImagenLandingSimple = multer({
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
  uploadImagenLandingSimple.single('imagen')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'La imagen supera el máximo permitido de 1MB.' });
    }
    return res.status(400).json({ message: err.message || 'Error al subir la imagen.' });
  });
}

function manejarError(res, err, defaultMsg) {
  console.error('[landing-simple]', err.message);
  const status = err.message === 'Landing no encontrada.' || err.message === 'Template no encontrado.'
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
    const landings = await LandingSimpleService.listar(tienda.id);
    return res.json(landings);
  } catch (err) {
    console.error('[landing-simple] listar:', err.message);
    return res.status(500).json({ message: 'Error al listar landings.' });
  }
}

async function crear(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    if (!req.body.template_id) {
      return res.status(400).json({ message: 'Se requiere el ID del template.' });
    }
    const landing = await LandingSimpleService.crear(tienda.id, req.usuario.tenantId, req.body.template_id);
    return res.status(201).json(landing);
  } catch (err) {
    return manejarError(res, err, 'Error al crear la landing.');
  }
}

async function crearDesdeOnboarding(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const landing = await LandingSimpleService.crearDesdeOnboarding(
      tienda.id,
      req.usuario.tenantId,
      req.body.template_slug || 'basico',
      req.body.items || [],
    );
    await AuthTracking.registrarEventoConNotificacion({
      tipo: 'onboarding_landing_generated',
      req,
      usuario: req.usuario,
      metadata: {
        tienda_id: tienda.id,
        landing_id: landing.id,
        template_slug: req.body.template_slug || 'basico',
        productos_seleccionados: Array.isArray(req.body.items) ? req.body.items.length : 0,
      },
    });
    return res.status(201).json(landing);
  } catch (err) {
    return manejarError(res, err, 'Error al generar la landing del onboarding.');
  }
}

/**
 * Lienzo en blanco — no recibe template_id: el template de código es uno
 * solo y global (slug 'lienzo-blanco'), lo resuelve el servicio. El
 * frontend nunca tiene que conocer su id.
 */
async function crearLienzoBlanco(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const landing = await LandingSimpleService.crearLienzoBlanco(tienda.id, req.usuario.tenantId, tienda.nombre);
    return res.status(201).json(landing);
  } catch (err) {
    return manejarError(res, err, 'Error al crear la landing en blanco.');
  }
}

async function detalle(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const landing = await LandingSimpleService.obtener(req.params.id, tienda.id);
    return res.json(landing);
  } catch (err) {
    return manejarError(res, err, 'Error al obtener la landing.');
  }
}

async function actualizar(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const landing = await LandingSimpleService.actualizar(req.params.id, tienda.id, req.usuario.tenantId, req.body);
    return res.json(landing);
  } catch (err) {
    return manejarError(res, err, 'Error al actualizar la landing.');
  }
}

async function eliminar(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    await LandingSimpleService.eliminar(req.params.id, tienda.id);
    return res.json({ message: 'Landing eliminada.' });
  } catch (err) {
    return manejarError(res, err, 'Error al eliminar la landing.');
  }
}

async function cambiarEstado(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const landing = await LandingSimpleService.cambiarEstado(req.params.id, tienda.id, !!req.body.activo);
    return res.json(landing);
  } catch (err) {
    return manejarError(res, err, 'Error al cambiar el estado de la landing.');
  }
}

async function subirImagenGenerica(req, res, { actualizar, opts, keyPrefix, defaultMsg }) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) { await ImagenService.borrarArchivoSeguro(req.file?.path); return; }

    if (!req.file) return res.status(400).json({ message: 'No se recibió ningún archivo.' });

    const imagenData = await ImagenService.procesarArchivoParaR2(req.file, `${keyPrefix}/${req.params.id}`, opts);

    const { landing, anterior } = await actualizar(req.params.id, tienda.id, imagenData);
    if (anterior) {
      await ImagenService.eliminarObjetoStorage(anterior);
    }
    return res.status(201).json(landing);
  } catch (err) {
    await ImagenService.borrarArchivoSeguro(req.file?.path);
    return manejarError(res, err, defaultMsg);
  }
}

async function eliminarImagenGenerica(req, res, { quitar, defaultMsg }) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;

    const { landing, anterior } = await quitar(req.params.id, tienda.id);
    if (anterior) {
      await ImagenService.eliminarObjetoStorage(anterior);
    }
    return res.json(landing);
  } catch (err) {
    return manejarError(res, err, defaultMsg);
  }
}

async function subirLogo(req, res) {
  return subirImagenGenerica(req, res, {
    actualizar: (id, tiendaId, imagenData) => LandingSimpleService.actualizarImagenLogo(id, tiendaId, imagenData),
    opts: { width: 400, quality: 85 },
    keyPrefix: 'landings/logo',
    defaultMsg: 'Error al subir el logo.',
  });
}

async function eliminarLogo(req, res) {
  return eliminarImagenGenerica(req, res, {
    quitar: (id, tiendaId) => LandingSimpleService.quitarImagenLogo(id, tiendaId),
    defaultMsg: 'Error al quitar el logo.',
  });
}

async function subirHeroImagen(req, res) {
  return subirImagenGenerica(req, res, {
    actualizar: (id, tiendaId, imagenData) => LandingSimpleService.actualizarImagenHero(id, tiendaId, imagenData),
    opts: { width: 1600, quality: 82 },
    keyPrefix: 'landings/banner',
    defaultMsg: 'Error al subir la imagen del hero.',
  });
}

async function eliminarHeroImagen(req, res) {
  return eliminarImagenGenerica(req, res, {
    quitar: (id, tiendaId) => LandingSimpleService.quitarImagenHero(id, tiendaId),
    defaultMsg: 'Error al quitar la imagen del hero.',
  });
}

module.exports = {
  listar, crear, crearDesdeOnboarding, crearLienzoBlanco, detalle, actualizar, eliminar, cambiarEstado,
  subirImagenMiddleware,
  subirLogo, eliminarLogo,
  subirHeroImagen, eliminarHeroImagen,
};
