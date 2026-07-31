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
 */

const { Tienda } = require('../models');
const LandingService = require('../services/landing.service');

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

module.exports = { listar, crear, detalle, actualizar, eliminar, cambiarEstado };
