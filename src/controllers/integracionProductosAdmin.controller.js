'use strict';

/**
 * Lado admin (panel de Gesicomm, con sesión): el comercio genera y revoca
 * las API Keys que le va a dar a su sistema externo. Nunca ve ni puede
 * recuperar una key ya creada en texto plano — solo el momento de crearla.
 */
const service = require('../services/integracionProductos.service');

function exigirTiendaActiva(req) {
  if (!req.usuario.tiendaId) {
    const err = new Error('Seleccioná una tienda antes de gestionar integraciones.');
    err.status = 409;
    err.codigo = 'TIENDA_NO_SELECCIONADA';
    throw err;
  }
  return req.usuario.tiendaId;
}

function manejarError(res, err) {
  const status = err.status || 400;
  if (status >= 500) console.error('[integraciones-productos-admin]', err);
  res.status(status).json({ message: err.message || 'No se pudo completar la operación.', codigo: err.codigo || null });
}

async function listar(req, res) {
  try {
    res.json(await service.listarCredenciales(exigirTiendaActiva(req), req.usuario.id));
  } catch (err) { manejarError(res, err); }
}

async function crear(req, res) {
  try {
    const credencial = await service.crearCredencial({
      tiendaId: exigirTiendaActiva(req),
      usuarioId: req.usuario.id,
      nombre: req.body?.nombre,
    });
    res.status(201).json(credencial);
  } catch (err) { manejarError(res, err); }
}

async function revocar(req, res) {
  try {
    res.json(await service.revocarCredencial(exigirTiendaActiva(req), req.usuario.id, Number(req.params.id)));
  } catch (err) { manejarError(res, err); }
}

// ---------------------------------------------------------------
// Keys de PROVEEDOR (solo administrador). Son las que se le entregan a un
// proveedor externo para que cargue su catálogo: lo que sube con esa key
// entra al catálogo global y lo ve todo comercio. Por eso no las puede
// generar un comercio — a diferencia de las de arriba, que son la
// integración del ERP propio de cada tienda.
// ---------------------------------------------------------------

async function listarProveedores(req, res) {
  try {
    res.json(await service.listarCredencialesProveedor(req.usuario.tenantId));
  } catch (err) { manejarError(res, err); }
}

async function crearProveedor(req, res) {
  try {
    res.status(201).json(await service.crearCredencialProveedor({
      inquilinoId: req.usuario.tenantId,
      usuarioId: req.usuario.id,
      nombre: req.body?.nombre,
      logo_url: req.body?.logo_url,
    }));
  } catch (err) { manejarError(res, err); }
}

async function revocarProveedor(req, res) {
  try {
    res.json(await service.revocarCredencialProveedor(req.usuario.tenantId, Number(req.params.id)));
  } catch (err) { manejarError(res, err); }
}

module.exports = { listar, crear, revocar, listarProveedores, crearProveedor, revocarProveedor };
