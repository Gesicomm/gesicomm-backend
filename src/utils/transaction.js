'use strict';

/**
 * Revierte una transacción de Sequelize sin propagar el error si falla.
 *
 * Un `await t.rollback()` suelto dentro de un catch es un riesgo: si la
 * conexión ya está rota (pool perdió el cliente) o la transacción ya
 * terminó, rollback() rechaza, y como ya estamos en el catch nadie más
 * atrapa ese rechazo — se vuelve un unhandled rejection que tumba
 * el proceso entero de Node, no solo el request que falló.
 */
async function rollbackSeguro(t) {
  if (!t || t.finished) return;
  try {
    await t.rollback();
  } catch (err) {
    console.error('[rollbackSeguro] No se pudo revertir la transacción:', err.message);
  }
}

module.exports = { rollbackSeguro };
