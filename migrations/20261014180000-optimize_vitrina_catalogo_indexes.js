'use strict';

// CONCURRENTLY mantiene disponibles las lecturas y escrituras del catálogo.
// No envolver esta migración en una transacción.
const indices = [
  ['idx_vitrina_productos_nombre', `ON productos (inquilino_id, nombre, id) WHERE activo = true AND estado_venta = 'en_venta'`],
  ['idx_vitrina_productos_creador_nombre', `ON productos (inquilino_id, creado_por, nombre, id) WHERE activo = true AND estado_venta = 'en_venta'`],
  ['idx_vitrina_combos_nombre', `ON producto_combos (inquilino_id, nombre, id) WHERE estado = 'ACTIVO'`],
  ['idx_productos_sku_normalizado', `ON productos (inquilino_id, upper(trim(sku)))`],
  ['idx_vitrina_productos_nombre_trgm', `ON productos USING gin (nombre gin_trgm_ops) WHERE activo = true AND estado_venta = 'en_venta'`],
  ['idx_vitrina_productos_descripcion_trgm', `ON productos USING gin (descripcion_corta gin_trgm_ops) WHERE activo = true AND estado_venta = 'en_venta'`],
];

async function conConexion(sequelize, operacion) {
  const connection = await sequelize.connectionManager.getConnection({ type: 'WRITE' });
  try {
    await connection.query("SET lock_timeout = '5s'");
    await connection.query("SET statement_timeout = '60s'");
    await operacion(connection);
  } finally {
    try {
      await connection.query('RESET lock_timeout');
      await connection.query('RESET statement_timeout');
    } finally {
      await sequelize.connectionManager.releaseConnection(connection);
    }
  }
}

module.exports = {
  async up(queryInterface) {
    await conConexion(queryInterface.sequelize, async connection => {
      await connection.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      for (const [nombre, definicion] of indices) {
        // Un intento concurrente interrumpido puede dejar un índice inválido.
        // Solo reparar los índices propios de esta migración.
        const { rows } = await connection.query(`
          SELECT i.indisvalid FROM pg_index i
          WHERE i.indexrelid = to_regclass($1)
        `, [nombre]);
        if (rows.some(r => !r.indisvalid)) await connection.query(`DROP INDEX CONCURRENTLY IF EXISTS "${nombre}"`);
        await connection.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${nombre}" ${definicion}`);
      }
    });
  },
  async down(queryInterface) {
    await conConexion(queryInterface.sequelize, async connection => {
      for (const [nombre] of [...indices].reverse()) {
        await connection.query(`DROP INDEX CONCURRENTLY IF EXISTS "${nombre}"`);
      }
    });
  },
};
