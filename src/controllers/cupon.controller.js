'use strict';

const CuponService = require('../services/cupon.service');

/**
 * Cupones del comercio. Todo cuelga de req.usuario.id: un comercio solo ve
 * y edita los suyos, sin importar qué id llegue por la URL (el service
 * filtra por usuario_id además de por id).
 */

function manejarError(res, err, defecto) {
  const mensaje = err.message || defecto;
  // Los errores del service son de negocio y están escritos para leerse
  // (código repetido, porcentaje inválido, cupón inexistente): van con 400
  // y su texto. Cualquier otra cosa es un 500 genérico.
  const esDeNegocio = /obligatorio|porcentaje|Ya tenés|no encontrado|al menos un producto/i.test(mensaje);
  if (!esDeNegocio) console.error('[cupones]', err);
  return res.status(esDeNegocio ? 400 : 500).json({ message: esDeNegocio ? mensaje : defecto });
}

async function listar(req, res) {
  try {
    return res.json({ cupones: await CuponService.listar(req.usuario.id) });
  } catch (err) {
    return manejarError(res, err, 'Error al listar los cupones.');
  }
}

async function crear(req, res) {
  try {
    const cupon = await CuponService.crear(req.body, req.usuario.id, req.usuario.tenantId);
    return res.status(201).json(cupon);
  } catch (err) {
    return manejarError(res, err, 'Error al crear el cupón.');
  }
}

async function actualizar(req, res) {
  try {
    return res.json(await CuponService.actualizar(req.params.id, req.body, req.usuario.id));
  } catch (err) {
    return manejarError(res, err, 'Error al actualizar el cupón.');
  }
}

async function eliminar(req, res) {
  try {
    await CuponService.eliminar(req.params.id, req.usuario.id);
    return res.json({ message: 'Cupón eliminado.' });
  } catch (err) {
    return manejarError(res, err, 'Error al eliminar el cupón.');
  }
}

module.exports = { listar, crear, actualizar, eliminar };
