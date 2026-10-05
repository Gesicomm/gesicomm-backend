'use strict';

/**
 * Controller de la Vitrina del usuario.
 *
 * GET  /api/vitrina/catalogo                   → Productos + combos activos con precio propio
 * PUT  /api/vitrina/productos/:id/precio        → Definir precio propio de un producto
 * PUT  /api/vitrina/combos/:id/precio           → Definir precio propio de un combo
 * GET  /api/vitrina/productos/:id/sensibilidad  → Análisis de sensibilidad de un producto
 * GET  /api/vitrina/combos/:id/sensibilidad     → Análisis de sensibilidad de un combo
 */

const PrecioUsuarioService = require('../services/precioUsuario.service');

async function catalogo(req, res) {
  try {
    const esAdmin = req.usuario.rol === 'administrador';
    const resultado = await PrecioUsuarioService.listarCatalogo(req.usuario.id, req.usuario.tenantId, esAdmin);
    return res.json(resultado);
  } catch (err) {
    console.error('[vitrina] catalogo:', err.message);
    return res.status(500).json({ message: 'Error al obtener el catálogo.' });
  }
}


async function catalogoPaginado(req, res) {
  try {
    const esAdmin = req.usuario.rol === 'administrador';
    const resultado = await PrecioUsuarioService.listarCatalogoPaginado(req.usuario.id, req.usuario.tenantId, req.body, esAdmin);
    return res.json(resultado);
  } catch (err) {
    console.error('[vitrina] catalogoPaginado:', err.message);
    return res.status(500).json({ message: 'Error al obtener el catálogo paginado.' });
  }
}

async function guardarPrecioProducto(req, res) {
  try {
    const esAdmin = req.usuario.rol === 'administrador';
    const resultado = await PrecioUsuarioService.guardarPrecioProducto(
      req.usuario.id, req.usuario.tenantId, req.params.id, req.body.precio, esAdmin,
    );
    return res.json(resultado);
  } catch (err) {
    console.error('[vitrina] guardarPrecioProducto:', err.message);
    const status = err.message === 'Producto no encontrado.' ? 404 : 400;
    return res.status(status).json({ message: err.message || 'Error al guardar el precio.' });
  }
}

async function categorizarProductos(req, res) {
  try {
    const esAdmin = req.usuario.rol === 'administrador';
    const resultado = await PrecioUsuarioService.categorizarProductos(
      req.usuario.id,
      req.usuario.tenantId,
      req.body,
      esAdmin,
    );
    return res.json(resultado);
  } catch (err) {
    console.error('[vitrina] categorizarProductos:', err.message);
    const status = err.message?.includes('no encontrado') ? 404
      : err.message?.includes('requerid') || err.message?.includes('Seleccion') ? 400
      : 500;
    return res.status(status).json({ message: err.message || 'Error al categorizar productos.' });
  }
}

async function guardarPrecioCombo(req, res) {
  try {
    const esAdmin = req.usuario.rol === 'administrador';
    const resultado = await PrecioUsuarioService.guardarPrecioCombo(
      req.usuario.id, req.usuario.tenantId, req.params.id, req.body.precio, esAdmin,
    );
    return res.json(resultado);
  } catch (err) {
    console.error('[vitrina] guardarPrecioCombo:', err.message);
    const status = err.message === 'Combo no encontrado.' ? 404 : 400;
    return res.status(status).json({ message: err.message || 'Error al guardar el precio.' });
  }
}

async function sensibilidadProducto(req, res) {
  try {
    const esAdmin = req.usuario.rol === 'administrador';
    const resultado = await PrecioUsuarioService.analizarSensibilidadProducto(
      req.usuario.id, req.usuario.tenantId, req.params.id, esAdmin,
    );
    return res.json(resultado);
  } catch (err) {
    console.error('[vitrina] sensibilidadProducto:', err.message);
    const status = err.message === 'Producto no encontrado.' ? 404 : 400;
    return res.status(status).json({ message: err.message || 'Error al calcular el análisis de sensibilidad.' });
  }
}

async function sensibilidadCombo(req, res) {
  try {
    const esAdmin = req.usuario.rol === 'administrador';
    const resultado = await PrecioUsuarioService.analizarSensibilidadCombo(
      req.usuario.id, req.usuario.tenantId, req.params.id, esAdmin,
    );
    return res.json(resultado);
  } catch (err) {
    console.error('[vitrina] sensibilidadCombo:', err.message);
    const status = err.message === 'Combo no encontrado.' ? 404 : 400;
    return res.status(status).json({ message: err.message || 'Error al calcular el análisis de sensibilidad.' });
  }
}

module.exports = {
  catalogo,
  catalogoPaginado,
  guardarPrecioProducto,
  categorizarProductos,
  guardarPrecioCombo,
  sensibilidadProducto,
  sensibilidadCombo,
};
