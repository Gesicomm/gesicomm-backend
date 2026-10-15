'use strict';

const { Tienda, Usuario } = require('../models');

const LIMITE_MANUAL = 500;
const LIMITE_PRUEBA = 5000;

function esTiendaDePrueba(tienda) {
  const nombre = String(tienda?.nombre || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return nombre === 'llevatelofacil'
    && String(tienda?.Usuario?.correo_electronico || '').trim().toLowerCase() === 'andre@gmail.com';
}

async function obtenerLimiteManual(tiendaId) {
  // La excepción usa el dueño persistido de ESTA tienda, nunca el payload.
  const tienda = await Tienda.findByPk(tiendaId, {
    attributes: ['id', 'nombre', 'usuario_id'],
    include: [{ model: Usuario, attributes: ['correo_electronico'] }],
  });
  return esTiendaDePrueba(tienda) ? LIMITE_PRUEBA : LIMITE_MANUAL;
}

async function validarItemsLienzo(items, tiendaId) {
  const limite = await obtenerLimiteManual(tiendaId);
  if (!Array.isArray(items) || items.length > limite) {
    const err = new Error('Validación fallida.');
    err.errores = [Array.isArray(items)
      ? `Una lista elegida a mano admite hasta ${limite} productos. Para vender todo el catálogo usá "Todos" o "Por categoría".`
      : 'Los productos deben enviarse como una lista.'];
    throw err;
  }
  return limite;
}

module.exports = { LIMITE_MANUAL, obtenerLimiteManual, validarItemsLienzo };
