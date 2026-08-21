'use strict';

/**
 * Controller privado de EMBUDOS — mismo patrón que landingSimple.controller.js
 * (resuelve la tienda propia del usuario antes de cualquier acción), acotado
 * al módulo de funnels. Ver funnel.service.js.
 *
 * GET    /api/mis-funnels                    → listar mis embudos
 * GET    /api/mis-funnels/templates          → tipos de embudo disponibles
 * GET    /api/mis-funnels/producto/:productoId → el embudo de ese producto (404 si no tiene)
 * POST   /api/mis-funnels                    → crear embudo para un producto
 * GET    /api/mis-funnels/:id                → detalle
 * PUT    /api/mis-funnels/:id                → actualizar contenido permitido
 * DELETE /api/mis-funnels/:id                → eliminar
 * PATCH  /api/mis-funnels/:id/estado         → publicar/despublicar
 */

const { Tienda } = require('../models');
const FunnelService = require('../services/funnel.service');

async function resolverTiendaPropia(req, res) {
  const tienda = await Tienda.findOne({ where: { usuario_id: req.usuario.id } });
  if (!tienda) {
    res.status(409).json({ message: 'Todavía no tenés una tienda creada. Creála antes de armar un embudo.' });
    return null;
  }
  return tienda;
}

async function listarTemplates(req, res) {
  try {
    return res.json(await FunnelService.listarTemplates());
  } catch (err) {
    console.error('[funnel] listarTemplates:', err.message);
    return res.status(500).json({ message: 'Error al listar los tipos de embudo.' });
  }
}

async function listar(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    return res.json(await FunnelService.listar(tienda.id));
  } catch (err) {
    console.error('[funnel] listar:', err.message);
    return res.status(500).json({ message: 'Error al listar embudos.' });
  }
}

async function porProducto(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const funnel = await FunnelService.obtenerPorProducto(req.params.productoId, tienda.id);
    // 404 es la respuesta esperada cuando el producto todavía no tiene
    // embudo — el front lo usa para mostrar el selector de tipo.
    if (!funnel) return res.status(404).json({ message: 'Este producto todavía no tiene embudo.' });
    return res.json(funnel);
  } catch (err) {
    console.error('[funnel] porProducto:', err.message);
    return res.status(500).json({ message: 'Error al obtener el embudo del producto.' });
  }
}

async function crear(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const { producto_id, template_id } = req.body;
    if (!producto_id) return res.status(400).json({ message: 'Falta el producto del embudo.' });
    if (!template_id) return res.status(400).json({ message: 'Falta el tipo de embudo.' });
    const funnel = await FunnelService.crear(tienda.id, req.usuario.tenantId, producto_id, template_id);
    return res.status(201).json(funnel);
  } catch (err) {
    console.error('[funnel] crear:', err.message);
    return res.status(400).json({ message: err.message || 'Error al crear el embudo.' });
  }
}

async function detalle(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    return res.json(await FunnelService.obtener(req.params.id, tienda.id));
  } catch (err) {
    return res.status(404).json({ message: err.message || 'Embudo no encontrado.' });
  }
}

async function actualizar(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    return res.json(await FunnelService.actualizar(req.params.id, tienda.id, req.body));
  } catch (err) {
    console.error('[funnel] actualizar:', err.message);
    return res.status(400).json({ message: err.message || 'Error al guardar el embudo.' });
  }
}

async function cambiarEstado(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    return res.json(await FunnelService.cambiarEstado(req.params.id, tienda.id, req.body.activo));
  } catch (err) {
    console.error('[funnel] cambiarEstado:', err.message);
    return res.status(400).json({ message: err.message || 'Error al cambiar el estado del embudo.' });
  }
}

async function eliminar(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    return res.json(await FunnelService.eliminar(req.params.id, tienda.id));
  } catch (err) {
    console.error('[funnel] eliminar:', err.message);
    return res.status(400).json({ message: err.message || 'Error al eliminar el embudo.' });
  }
}

module.exports = {
  listarTemplates,
  listar,
  porProducto,
  crear,
  detalle,
  actualizar,
  cambiarEstado,
  eliminar,
};
