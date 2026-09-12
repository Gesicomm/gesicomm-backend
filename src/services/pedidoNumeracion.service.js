'use strict';

const { sequelize } = require('../models');

async function reservarNumeroPedido(usuarioId, transaction) {
  const usuario_id = Number(usuarioId);
  if (!Number.isInteger(usuario_id) || usuario_id <= 0) {
    throw new Error('Usuario inválido para numerar el pedido.');
  }

  await sequelize.query(`
    INSERT INTO pedido_counters (usuario_id, ultimo_numero_pedido, created_at, updated_at)
    VALUES (:usuario_id, 0, NOW(), NOW())
    ON CONFLICT (usuario_id) DO NOTHING
  `, {
    replacements: { usuario_id },
    transaction,
  });

  const [rows] = await sequelize.query(`
    UPDATE pedido_counters
    SET ultimo_numero_pedido = ultimo_numero_pedido + 1,
        updated_at = NOW()
    WHERE usuario_id = :usuario_id
    RETURNING ultimo_numero_pedido
  `, {
    replacements: { usuario_id },
    transaction,
  });

  const numeroPedido = Number(rows?.[0]?.ultimo_numero_pedido);
  if (!Number.isInteger(numeroPedido) || numeroPedido <= 0) {
    throw new Error('No se pudo reservar el número de pedido.');
  }

  return numeroPedido;
}

module.exports = {
  reservarNumeroPedido,
};
