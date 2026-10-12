'use strict';

/**
 * Lado socio externo (API Key, sin sesión). Ver docs/api-integraciones-productos.md
 * para el contrato completo que le corresponde documentar a cada tienda
 * que integra.
 */
const service = require('../services/integracionProductos.service');

function manejarError(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('[integraciones-productos-api]', err);
  res.status(status).json({ ok: false, error: status >= 500 ? 'Error interno del servidor.' : err.message, codigo: err.codigo || 'ERROR_INTERNO' });
}

async function ping(req, res) {
  res.json({ ok: true, integracion: req.integracion.codigo });
}

async function upsertProducto(req, res) {
  try {
    res.json({ ok: true, ...(await service.upsertProducto(req.integracion, req.body)) });
  } catch (err) { manejarError(res, err); }
}

async function sincronizarLote(req, res) {
  try {
    res.json({ ok: true, ...(await service.sincronizarLote(req.integracion, req.body?.productos)) });
  } catch (err) { manejarError(res, err); }
}

async function actualizarStock(req, res) {
  try {
    res.json({ ok: true, ...(await service.actualizarStock(req.integracion, req.params.sku, req.body || {})) });
  } catch (err) { manejarError(res, err); }
}

async function actualizarPrecio(req, res) {
  try {
    res.json({ ok: true, ...(await service.actualizarPrecio(req.integracion, req.params.sku, req.body || {})) });
  } catch (err) { manejarError(res, err); }
}

async function darDeBaja(req, res) {
  try {
    res.json({ ok: true, ...(await service.darDeBaja(req.integracion, req.params.sku, req.body || {})) });
  } catch (err) { manejarError(res, err); }
}

async function consultarProducto(req, res) {
  try {
    res.json({ ok: true, ...(await service.consultarProducto(req.integracion, req.params.sku)) });
  } catch (err) { manejarError(res, err); }
}

module.exports = { ping, upsertProducto, sincronizarLote, actualizarStock, actualizarPrecio, darDeBaja, consultarProducto };
