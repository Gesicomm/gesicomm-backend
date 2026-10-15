'use strict';

const McpService = require('../services/mcp.service');
const { Tienda } = require('../models');

function textoError(err, fallback) {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  return fallback;
}

/**
 * Resuelve la tienda propia del usuario autenticado.
 */
async function resolverTiendaMCP(req, res) {
  const tiendaId = req.query.tienda_id || req.body.tienda_id || req.usuario?.tiendaId;
  if (!tiendaId) {
    res.status(400).json({ ok: false, error: 'Falta especificar tienda_id o seleccionar una tienda activa.' });
    return null;
  }
  const tienda = await Tienda.findOne({
    where: { id: Number(tiendaId), usuario_id: req.usuario.id },
  });
  if (!tienda) {
    res.status(404).json({ ok: false, error: 'La tienda no existe o no tenés permisos para acceder a ella.' });
    return null;
  }
  return tienda;
}

exports.generarToken = async (req, res) => {
  try {
    const tienda = await resolverTiendaMCP(req, res);
    if (!tienda) return;

    const data = McpService.generarTokenMCP(req.usuario, tienda.id);
    return res.json({ ok: true, ...data });
  } catch (err) {
    return res.status(400).json({ ok: false, error: textoError(err, 'Error al generar token MCP.') });
  }
};

exports.listarLandings = async (req, res) => {
  try {
    const tienda = await resolverTiendaMCP(req, res);
    if (!tienda) return;

    const landings = await McpService.listarLandings(tienda.id);
    return res.json({ ok: true, landings });
  } catch (err) {
    return res.status(400).json({ ok: false, error: textoError(err, 'Error al listar landings.') });
  }
};

exports.obtenerContexto = async (req, res) => {
  try {
    const tienda = await resolverTiendaMCP(req, res);
    if (!tienda) return;

    const contexto = await McpService.obtenerContextoComercial(req.params.id, tienda.id);
    return res.json({ ok: true, contexto });
  } catch (err) {
    return res.status(404).json({ ok: false, error: textoError(err, 'Error al obtener contexto de la landing.') });
  }
};

exports.obtenerCodigo = async (req, res) => {
  try {
    const tienda = await resolverTiendaMCP(req, res);
    if (!tienda) return;

    const vista = req.query.vista || 'inicio';
    const contentId = req.query.content_id || null;
    const resultado = await McpService.obtenerCodigo(req.params.id, tienda.id, vista, contentId);
    return res.json({ ok: true, ...resultado });
  } catch (err) {
    return res.status(404).json({ ok: false, error: textoError(err, 'Error al obtener código de la landing.') });
  }
};

exports.validarCodigo = async (req, res) => {
  try {
    const { html, vista = 'inicio' } = req.body;
    const resultado = McpService.validarMotorComercial(html, vista);
    return res.json({ ok: true, ...resultado });
  } catch (err) {
    return res.status(400).json({ ok: false, error: textoError(err, 'Error al validar código.') });
  }
};

exports.guardarCodigo = async (req, res) => {
  try {
    const tienda = await resolverTiendaMCP(req, res);
    if (!tienda) return;

    const resultado = await McpService.guardarCodigo(
      req.params.id,
      tienda.id,
      req.usuario.tenantId,
      req.body
    );
    return res.json(resultado);
  } catch (err) {
    const status = err.errores ? 422 : 400;
    return res.status(status).json({
      ok: false,
      error: textoError(err, 'Error al guardar código de la landing.'),
      errores: err.errores || [],
      advertencias: err.advertencias || [],
    });
  }
};
