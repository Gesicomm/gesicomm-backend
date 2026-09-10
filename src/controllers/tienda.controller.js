'use strict';

/**
 * Controller privado de Tienda — gestión de la identidad pública propia.
 *
 * GET    /api/mi-tienda                          → mi tienda (o null si no existe)
 * POST   /api/mi-tienda                           → crear
 * PUT    /api/mi-tienda                           → actualizar (nombre/colores/contacto/pixel)
 * GET    /api/mi-tienda/subdominio/disponibilidad  → check en vivo
 * POST   /api/mi-tienda/dominio-propio             → registrar dominio propio
 * GET    /api/mi-tienda/dominio-propio/estado      → consultar verificación
 * PATCH  /api/mi-tienda/dominio-propio/habilitado  → apagar/prender sin borrarlo
 * DELETE /api/mi-tienda/dominio-propio             → revocar dominio propio
 */

const TiendaService = require('../services/tienda.service');
const AuthTracking = require('../services/authTracking.service');

function manejarError(res, err, defaultMsg) {
  console.error('[tienda]', err.message);
  const status = err.message.includes('no tenés una tienda') ? 404 : (err.errores ? 422 : 400);
  return res.status(status).json({ message: err.message || defaultMsg, errores: err.errores });
}

async function obtener(req, res) {
  try {
    const tienda = await TiendaService.obtenerPorUsuario(req.usuario.id);
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
    const tienda = await TiendaService.actualizar(req.usuario.id, req.body);
    return res.json(tienda);
  } catch (err) {
    return manejarError(res, err, 'Error al actualizar la tienda.');
  }
}

async function disponibilidadSubdominio(req, res) {
  try {
    const resultado = await TiendaService.verificarDisponibilidadSubdominio(req.query.sub, req.usuario.id);
    return res.json(resultado);
  } catch (err) {
    console.error('[tienda] disponibilidadSubdominio:', err.message);
    return res.status(500).json({ message: 'Error al verificar el subdominio.' });
  }
}

async function guardarDominioPropio(req, res) {
  try {
    const resultado = await TiendaService.guardarDominioPropio(req.usuario.id, req.body.dominio);
    return res.status(201).json(resultado);
  } catch (err) {
    return manejarError(res, err, 'Error al configurar el dominio propio.');
  }
}

async function estadoDominioPropio(req, res) {
  try {
    const resultado = await TiendaService.verificarDominioPropio(req.usuario.id);
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
      req.usuario.id, req.body.habilitado,
    );
    return res.json(resultado);
  } catch (err) {
    return manejarError(res, err, 'Error al cambiar el estado del dominio propio.');
  }
}

async function eliminarDominioPropio(req, res) {
  try {
    const tienda = await TiendaService.eliminarDominioPropio(req.usuario.id);
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

module.exports = {
  obtener, crear, actualizar, disponibilidadSubdominio,
  guardarDominioPropio, estadoDominioPropio, habilitacionDominioPropio,
  eliminarDominioPropio, whoisDominio
};
