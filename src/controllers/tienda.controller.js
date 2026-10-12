'use strict';

/**
 * Controller privado de Tienda — gestión de la identidad pública propia.
 * Todas las rutas operan sobre la TIENDA ACTIVA (req.usuario.tiendaId,
 * resuelta por el middleware resolverTiendaActiva a partir de la selección
 * hecha al loguearse), nunca sobre "la" tienda del usuario — un usuario
 * puede tener varias.
 *
 * GET    /api/mi-tienda                          → mi tienda activa (o null si no existe ninguna)
 * POST   /api/mi-tienda                           → crear una tienda nueva
 * PUT    /api/mi-tienda                           → actualizar (nombre/colores/contacto/pixel)
 * GET    /api/mi-tienda/subdominio/disponibilidad  → check en vivo
 * POST   /api/mi-tienda/dominio-propio             → registrar dominio propio
 * GET    /api/mi-tienda/dominio-propio/estado      → consultar verificación
 * PATCH  /api/mi-tienda/dominio-propio/habilitado  → apagar/prender sin borrarlo
 * DELETE /api/mi-tienda/dominio-propio             → revocar dominio propio
 * POST   /api/mi-tienda/logo                        → subir/reemplazar logo
 * DELETE /api/mi-tienda/logo                        → quitar logo
 * POST   /api/mi-tienda/favicon                     → subir/reemplazar favicon
 * DELETE /api/mi-tienda/favicon                     → quitar favicon (vuelve a usarse el logo)
 */

const TiendaService = require('../services/tienda.service');
const AuthTracking = require('../services/authTracking.service');
const FulfillmentService = require('../services/fulfillment.service');
const RedFulfillment = require('../services/redFulfillment.service');
const ImagenService = require('../services/imagen.service');
const TypographyService = require('../services/typography.service');

function manejarError(res, err, defaultMsg) {
  console.error('[tienda]', err.message);
  if (err.codigo === 'TIENDA_NO_SELECCIONADA') {
    return res.status(409).json({ message: err.message, codigo: err.codigo });
  }
  const status = err.message.includes('no tenés una tienda') ? 404 : (err.errores ? 422 : 400);
  return res.status(status).json({ message: err.message || defaultMsg, errores: err.errores });
}

/** Exige tienda activa antes de operar sobre ella (crear() es la excepción: no la necesita). */
function exigirTiendaActiva(req) {
  if (!req.usuario.tiendaId) {
    const err = new Error('Seleccioná una tienda primero.');
    err.codigo = 'TIENDA_NO_SELECCIONADA';
    throw err;
  }
  return req.usuario.tiendaId;
}

async function obtener(req, res) {
  try {
    if (!req.usuario.tiendaId) return res.json(null);
    const tienda = await TiendaService.obtener(req.usuario.tiendaId, req.usuario.id);
    return res.json(tienda);
  } catch (err) {
    console.error('[tienda] obtener:', err.message);
    return res.status(500).json({ message: 'Error al obtener la tienda.' });
  }
}

async function crear(req, res) {
  try {
    const tienda = await TiendaService.crear(req.usuario.id, req.usuario.tenantId, req.body);
    if (req.body?.onboarding === true) {
      await AuthTracking.registrarEventoConNotificacion({
        tipo: 'onboarding_store_created',
        req,
        usuario: req.usuario,
        metadata: {
          tienda_id: tienda.id,
          subdominio: tienda.subdominio,
          ficha: req.body?.onboarding_ficha || null,
        },
      });

      if (req.body?.onboarding_accion === 'configurar_mas_tarde') {
        await AuthTracking.registrarEventoConNotificacion({
          tipo: 'onboarding_skipped',
          req,
          usuario: req.usuario,
          metadata: {
            tienda_id: tienda.id,
            subdominio: tienda.subdominio,
          },
        });
      }
    }
    return res.status(201).json(tienda);
  } catch (err) {
    return manejarError(res, err, 'Error al crear la tienda.');
  }
}

async function actualizar(req, res) {
  try {
    const tienda = await TiendaService.actualizar(exigirTiendaActiva(req), req.usuario.id, req.body);
    return res.json(tienda);
  } catch (err) {
    return manejarError(res, err, 'Error al actualizar la tienda.');
  }
}

async function disponibilidadSubdominio(req, res) {
  try {
    const resultado = await TiendaService.verificarDisponibilidadSubdominio(req.query.sub, req.usuario.tiendaId || null);
    return res.json(resultado);
  } catch (err) {
    console.error('[tienda] disponibilidadSubdominio:', err.message);
    return res.status(500).json({ message: 'Error al verificar el subdominio.' });
  }
}

async function guardarDominioPropio(req, res) {
  try {
    const resultado = await TiendaService.guardarDominioPropio(exigirTiendaActiva(req), req.usuario.id, req.body.dominio);
    return res.status(201).json(resultado);
  } catch (err) {
    return manejarError(res, err, 'Error al configurar el dominio propio.');
  }
}

async function estadoDominioPropio(req, res) {
  try {
    const resultado = await TiendaService.verificarDominioPropio(exigirTiendaActiva(req), req.usuario.id);
    return res.json(resultado);
  } catch (err) {
    return manejarError(res, err, 'Error al verificar el dominio propio.');
  }
}

async function habilitacionDominioPropio(req, res) {
  try {
    if (typeof req.body.habilitado !== 'boolean') {
      return res.status(400).json({ message: 'Falta indicar si el dominio queda habilitado.' });
    }
    const resultado = await TiendaService.cambiarHabilitacionDominioPropio(
      exigirTiendaActiva(req), req.usuario.id, req.body.habilitado,
    );
    return res.json(resultado);
  } catch (err) {
    return manejarError(res, err, 'Error al cambiar el estado del dominio propio.');
  }
}

async function eliminarDominioPropio(req, res) {
  try {
    const tienda = await TiendaService.eliminarDominioPropio(exigirTiendaActiva(req), req.usuario.id);
    return res.json(tienda);
  } catch (err) {
    return manejarError(res, err, 'Error al eliminar el dominio propio.');
  }
}

async function whoisDominio(req, res) {
  try {
    if (!req.body.domain) return res.status(400).json({ message: 'El dominio es obligatorio.' });
    const proveedor = await TiendaService.obtenerInfoWhois(req.body.domain);
    return res.json({ proveedor });
  } catch (err) {
    console.error('[tienda] whoisDominio:', err.message);
    return res.status(500).json({ message: 'Error al consultar WHOIS.' });
  }
}

/** GET /api/mi-tienda/fulfillment — modalidad actual + contexto para decidir. */
async function obtenerFulfillment(req, res) {
  try {
    return res.json(await FulfillmentService.obtenerConfiguracion(req.usuario.id, req.usuario.tiendaId || null));
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[tienda] obtenerFulfillment:', err);
    return res.status(status).json({ message: status === 500 ? 'Error al obtener la configuración de entregas.' : err.message });
  }
}

/** POST /api/mi-tienda/fulfillment/depositos — listado paginado para elegir depósito propio. */
async function listarDepositosFulfillment(req, res) {
  try {
    return res.json(await FulfillmentService.listarDepositosPropios(req.usuario.id, req.body || {}));
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[tienda] listarDepositosFulfillment:', err);
    return res.status(status).json({ message: status === 500 ? 'Error al listar depósitos para entregas.' : err.message });
  }
}

/** PUT /api/mi-tienda/fulfillment — { modalidad, depositoId }. */
async function guardarFulfillment(req, res) {
  try {
    const resultado = await FulfillmentService.guardarConfiguracion(req.usuario.id, {
      modalidad: req.body?.modalidad,
      depositoId: req.body?.depositoId,
    }, req.usuario.tiendaId || null);
    return res.json(resultado);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[tienda] guardarFulfillment:', err);
    return res.status(status).json({ message: status === 500 ? 'Error al guardar la configuración de entregas.' : err.message });
  }
}

/**
 * GET /api/mi-tienda/fulfillment/cobertura — qué cubre Gesicomm y a qué
 * precio, consolidado por ciudad. Es SOLO LECTURA y a propósito no dice qué
 * proveedor entrega: eso es operación interna de Gesicomm, no algo que el
 * comercio contrate ni pueda modificar.
 */
async function coberturaGesicomm(req, res) {
  try {
    return res.json(await RedFulfillment.coberturaComercial());
  } catch (err) {
    console.error('[tienda] coberturaGesicomm:', err);
    return res.status(500).json({ message: 'Error al obtener la cobertura de Gesicomm.' });
  }
}

async function subirLogo(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: 'No se recibió ningún archivo.' });
    const tiendaId = exigirTiendaActiva(req);
    // Mismo tamaño que el logo de landing-simple: el header nunca lo muestra
    // más ancho que esto. WebP conserva la transparencia del PNG.
    const imagenData = await ImagenService.procesarArchivoParaR2(req.file, `tiendas/logo/${tiendaId}`, { width: 400, quality: 85 });
    const { tienda, anterior } = await TiendaService.actualizarLogo(tiendaId, req.usuario.id, imagenData);
    if (anterior) await ImagenService.eliminarObjetoStorage(anterior);
    return res.status(201).json(tienda);
  } catch (err) {
    await ImagenService.borrarArchivoSeguro(req.file?.path);
    return manejarError(res, err, 'Error al subir el logo.');
  }
}

async function eliminarLogo(req, res) {
  try {
    const { tienda, anterior } = await TiendaService.actualizarLogo(exigirTiendaActiva(req), req.usuario.id, null);
    if (anterior) await ImagenService.eliminarObjetoStorage(anterior);
    return res.json(tienda);
  } catch (err) {
    return manejarError(res, err, 'Error al quitar el logo.');
  }
}

async function subirFavicon(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: 'No se recibió ningún archivo.' });
    const tiendaId = exigirTiendaActiva(req);
    const imagenData = await ImagenService.procesarFaviconParaR2(req.file, `tiendas/favicon/${tiendaId}`);
    const { tienda, anterior } = await TiendaService.actualizarFavicon(tiendaId, req.usuario.id, imagenData);
    if (anterior) await ImagenService.eliminarObjetoStorage(anterior);
    return res.status(201).json(tienda);
  } catch (err) {
    await ImagenService.borrarArchivoSeguro(req.file?.path);
    return manejarError(res, err, 'Error al subir el favicon.');
  }
}

async function eliminarFavicon(req, res) {
  try {
    const { tienda, anterior } = await TiendaService.actualizarFavicon(exigirTiendaActiva(req), req.usuario.id, null);
    if (anterior) await ImagenService.eliminarObjetoStorage(anterior);
    return res.json(tienda);
  } catch (err) {
    return manejarError(res, err, 'Error al quitar el favicon.');
  }
}

async function guardarTipografia(req, res) {
  try {
    const typography = await TypographyService.guardarConfigTienda(exigirTiendaActiva(req), req.usuario.id, req.body || {});
    return res.json({ typography });
  } catch (err) {
    return manejarError(res, err, 'Error al guardar la tipografía.');
  }
}

async function subirFuente(req, res) {
  try {
    const font = await TypographyService.subirFuente(exigirTiendaActiva(req), req.usuario.id, req.file, req.body || {});
    return res.status(201).json(font);
  } catch (err) {
    return manejarError(res, err, 'Error al subir la fuente.');
  }
}

async function eliminarFuente(req, res) {
  try {
    const resultado = await TypographyService.eliminarFuente(exigirTiendaActiva(req), req.usuario.id, req.params.fontId);
    return res.json(resultado);
  } catch (err) {
    return manejarError(res, err, 'Error al eliminar la fuente.');
  }
}

module.exports = {
  obtener, crear, actualizar, disponibilidadSubdominio,
  coberturaGesicomm,
  guardarDominioPropio, estadoDominioPropio, habilitacionDominioPropio,
  eliminarDominioPropio, whoisDominio,
  obtenerFulfillment, listarDepositosFulfillment, guardarFulfillment,
  subirLogo, eliminarLogo,
  subirFavicon, eliminarFavicon,
  guardarTipografia, subirFuente, eliminarFuente,
};
