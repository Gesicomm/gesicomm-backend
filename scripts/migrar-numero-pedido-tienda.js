'use strict';

async function migrarNumeroPedidoTienda(sequelize) {
  await sequelize.transaction(async (transaction) => {
    const query = sql => sequelize.query(sql, { transaction });
    await query(`ALTER TABLE envios ADD COLUMN IF NOT EXISTS numero_pedido_tienda INTEGER`);
    await query(`ALTER TABLE envios ADD COLUMN IF NOT EXISTS es_lead BOOLEAN NOT NULL DEFAULT false`);
    await query(`CREATE TABLE IF NOT EXISTS pedido_tienda_counters (
      tienda_id INTEGER PRIMARY KEY REFERENCES tiendas(id) ON DELETE CASCADE,
      ultimo_numero_pedido INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )`);
    // Serializar el backfill con las altas: se ejecuta antes de atender pedidos.
    await query(`LOCK TABLE envios, pedido_tienda_counters IN SHARE ROW EXCLUSIVE MODE`);
    await query(`
      WITH unicas AS (
        SELECT usuario_id, MIN(id) AS tienda_id FROM tiendas
        GROUP BY usuario_id HAVING COUNT(*) = 1
      )
      UPDATE envios e SET tienda_id = u.tienda_id FROM unicas u
      WHERE e.tienda_id IS NULL AND e.usuario_id = u.usuario_id
    `);
    // Solo completar números faltantes. Reejecutar no renumera pedidos ni
    // reutiliza números de pedidos borrados: conserva también el contador.
    await query(`
      WITH maximos AS (
        SELECT tienda_id, MAX(numero_pedido_tienda) AS ultimo FROM envios
        WHERE tienda_id IS NOT NULL AND es_lead = false GROUP BY tienda_id
      ), numerados AS (
        SELECT e.id, ROW_NUMBER() OVER (
          PARTITION BY e.tienda_id ORDER BY e.created_at, e.id
        ) + GREATEST(COALESCE(m.ultimo, 0), COALESCE(c.ultimo_numero_pedido, 0)) AS numero
        FROM envios e
        LEFT JOIN maximos m ON m.tienda_id = e.tienda_id
        LEFT JOIN pedido_tienda_counters c ON c.tienda_id = e.tienda_id
        WHERE e.tienda_id IS NOT NULL AND e.numero_pedido_tienda IS NULL AND e.es_lead = false
      )
      UPDATE envios e SET numero_pedido_tienda = n.numero
      FROM numerados n WHERE e.id = n.id
    `);
    await query(`
      INSERT INTO pedido_tienda_counters (tienda_id, ultimo_numero_pedido)
      SELECT tienda_id, MAX(numero_pedido_tienda) FROM envios
      WHERE tienda_id IS NOT NULL AND numero_pedido_tienda IS NOT NULL AND es_lead = false GROUP BY tienda_id
      ON CONFLICT (tienda_id) DO UPDATE SET
        ultimo_numero_pedido = GREATEST(pedido_tienda_counters.ultimo_numero_pedido, EXCLUDED.ultimo_numero_pedido),
        updated_at = NOW()
    `);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_envios_tienda_numero_pedido
      ON envios (tienda_id, numero_pedido_tienda)`);
  });
}

module.exports = { migrarNumeroPedidoTienda };
