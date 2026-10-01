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
 * POST   /api/mis-landings/:id/testimonio-foto → subir foto de un testimonio (devuelve solo la URL)
 * POST   /api/mis-landings/:id/seccion-imagen → subir imagen de un campo de sección (devuelve solo la URL)
 * GET    /api/mis-landings/:id/estadisticas → visitas/conversaciones/CTR/productos más consultados
 * POST   /api/mis-landings/:id/estadisticas-rango → ídem, por rango de calendario (filtros dinámicos vía body)
 */

const path = require('path');
const multer = require('multer');
const { Tienda } = require('../models');
const LandingService = require('../services/landing.service');
const ImagenService = require('../services/imagen.service');
const { destinoUploadsTmp } = require('../utils/uploadTmp');

// Mismo filtro que imagen.controller.js (subida de fotos de producto) —
// instancia propia porque el destino (Landing) es un modelo distinto. Se
// reutiliza tanto para el banner como para la imagen OG: es el mismo tipo
// de subida, solo cambia a qué columna de Landing termina escribiendo.
const uploadImagenLanding = multer({
  storage: multer.diskStorage({
    destination: destinoUploadsTmp,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
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

/**
 * Garantiza y devuelve las 3 páginas fijas del sitio (Inicio/Catálogo/
 * Contacto) — ver LandingService.asegurarPaginasFijas(). Ruta montada
 * ANTES de /:id (ver routes/landing.js) para que Express no la capture
 * como si "paginas" fuera un id.
 */
async function paginas(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const paginas = await LandingService.asegurarPaginasFijas(tienda.id, req.usuario.tenantId);
    return res.json(paginas);
  } catch (err) {
    console.error('[landing] paginas:', err.message);
    return res.status(500).json({ message: 'Error al obtener las páginas.' });
  }
}

/**
 * Diseño de página propio de un producto — montado en
 * /api/productos/:id/pagina-secciones (ver routes/productos.js), no bajo
 * /mis-landings, porque el recurso es "la página de ESTE producto", no
 * una landing puntual.
 */
async function seccionesProducto(req, res) {
  try {
    const secciones = await LandingService.obtenerSeccionesProducto(req.params.id, req.usuario.tenantId);
    return res.json(secciones);
  } catch (err) {
    const status = err.message === 'Producto no encontrado.' ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al obtener el diseño del producto.' });
  }
}

async function guardarSeccionesProducto(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const secciones = await LandingService.guardarSeccionesProducto(
      req.params.id, req.usuario.tenantId, tienda.id, req.body.secciones || []
    );
    return res.json(secciones);
  } catch (err) {
    const status = err.message === 'Producto no encontrado.' ? 404 : 400;
    return res.status(status).json({ message: err.message || 'Error al guardar el diseño del producto.' });
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
 * Compartido por banner y por imagen OG: sube+redimensiona el archivo a R2
 * y lo cuelga del campo que indique `actualizar` (una de las dos funciones
 * _actualizarImagenCampo de LandingService), borrando de R2 (o del disco,
 * si la landing todavía tenía una imagen legacy) la anterior si había.
 */
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

async function subirBanner(req, res) {
  // Banner en formato ancho (hero) — no tiene sentido el mismo recorte de
  // 1200px que una foto de producto cuadrada/vertical.
  return subirImagenGenerica(req, res, {
    actualizar: (id, tiendaId, imagenData) => LandingService.actualizarImagenBanner(id, tiendaId, imagenData),
    opts: { width: 1600, quality: 82 },
    keyPrefix: 'landings/banner',
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
    actualizar: (id, tiendaId, imagenData) => LandingService.actualizarImagenSeo(id, tiendaId, imagenData),
    opts: { width: 1200, quality: 82 },
    keyPrefix: 'landings/seo',
    defaultMsg: 'Error al subir la imagen OG.',
  });
}

async function eliminarSeoImagen(req, res) {
  return eliminarImagenGenerica(req, res, {
    quitar: (id, tiendaId) => LandingService.quitarImagenSeo(id, tiendaId),
    defaultMsg: 'Error al quitar la imagen OG.',
  });
}

/**
 * Sube UNA foto de testimonio y devuelve solo la URL — a diferencia de
 * banner/seo-imagen, no la liga a una fila puntual: los testimonios se
 * reemplazan en bloque en cada Guardar (ver sincronizarTestimonios), así
 * que no tienen id estable entre guardados. El frontend pega esta URL en
 * el campo "foto" de la fila que esté editando en memoria, y viaja como
 * texto normal en el próximo PUT — mismo mecanismo que "etiqueta" en los
 * items de la landing.
 */
async function subirTestimonioFoto(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) { await ImagenService.borrarArchivoSeguro(req.file?.path); return; }

    if (!req.file) return res.status(400).json({ message: 'No se recibió ningún archivo.' });

    await LandingService.verificarPertenece(req.params.id, tienda.id);

    // Cuadrada y liviana — es un avatar, no un banner.
    const imagenData = await ImagenService.procesarArchivoParaR2(req.file, `testimonials/${req.params.id}`, { width: 400, quality: 82 });
    return res.status(201).json({ url: imagenData.url });
  } catch (err) {
    await ImagenService.borrarArchivoSeguro(req.file?.path);
    return manejarError(res, err, 'Error al subir la foto del testimonio.');
  }
}

/**
 * Sube UNA imagen para un campo `type: 'image'` de cualquier sección (ej.
 * el fondo del bloque "banner" del constructor) y devuelve solo la URL —
 * mismo criterio que subirTestimonioFoto: las secciones se reemplazan en
 * bloque en cada Guardar (ver sincronizarSecciones), así que tampoco tienen
 * id estable entre guardados. El frontend pega esta URL en el campo
 * correspondiente de `contenido` de la sección que esté editando.
 */
async function subirImagenSeccion(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) { await ImagenService.borrarArchivoSeguro(req.file?.path); return; }

    if (!req.file) return res.status(400).json({ message: 'No se recibió ningún archivo.' });

    await LandingService.verificarPertenece(req.params.id, tienda.id);

    // Ancho de banner (hero), no de avatar — a diferencia de la foto de testimonio.
    const imagenData = await ImagenService.procesarArchivoParaR2(req.file, `sections/${req.params.id}`, { width: 1600, quality: 82 });
    return res.status(201).json({ url: imagenData.url });
  } catch (err) {
    await ImagenService.borrarArchivoSeguro(req.file?.path);
    return manejarError(res, err, 'Error al subir la imagen de la sección.');
  }
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

async function estadisticasRango(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const datos = await LandingService.estadisticasRango(req.params.id, tienda.id, req.body || {});
    return res.json(datos);
  } catch (err) {
    return manejarError(res, err, 'Error al obtener las estadísticas.');
  }
}

module.exports = {
  listar, paginas, seccionesProducto, guardarSeccionesProducto, crear, detalle, actualizar, eliminar, cambiarEstado,
  subirImagenLandingMiddleware,
  subirBanner, eliminarBanner,
  subirSeoImagen, eliminarSeoImagen,
  subirTestimonioFoto,
  subirImagenSeccion,
  estadisticas, estadisticasRango,
};
