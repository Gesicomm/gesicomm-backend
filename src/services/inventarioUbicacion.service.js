'use strict';
const { sequelize, InventarioUbicacion, Deposito, ProductoVariante } = require('../models');
const { errorHttp } = require('./abastecimiento/estadoMachine');

// Serialize even the first receipt, where no inventory row exists to lock yet.
async function acreditar({ usuario_id, producto_id, variante_id = null, deposito_id, cantidad, alcance }, transaction) {
  if (!Number.isSafeInteger(Number(cantidad)) || Number(cantidad) <= 0) throw errorHttp('Cantidad de recepcion invalida.');
  const deposito = await Deposito.findOne({ where: { id: deposito_id, activo: true,
    ...(alcance === 'GESICOMM' ? { alcance: 'GESICOMM' } : { usuario_id, alcance: 'PROPIO' }) }, transaction });
  if (!deposito) throw errorHttp('El destino no es un deposito activo habilitado para esta recepcion.');
  if (variante_id && !await ProductoVariante.findOne({ where: { id: variante_id, producto_id, activo: true }, transaction })) {
    throw errorHttp('La variante no pertenece al producto o esta inactiva.');
  }
  const where = { usuario_id, producto_id, variante_id: variante_id || null, deposito_id };
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:ubicacion, 0))', {
    replacements: { ubicacion: `inventario:${usuario_id}:${producto_id}:${variante_id || 0}:${deposito_id}` }, transaction });
  const [ubicacion] = await InventarioUbicacion.findOrCreate({ where,
    defaults: { cantidad_disponible: 0, cantidad_reservada: 0 }, transaction });
  await ubicacion.increment('cantidad_disponible', { by: Number(cantidad), transaction });
  return ubicacion;
}

module.exports = { acreditar };
