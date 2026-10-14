'use strict';

const sequelize = require('../src/config/database');

/**
 * Desglose de stock salón/depósito en `productos` — el mismo que las
 * variantes ya tenían (ver ProductoVariante). Si el esquema está completo,
 * no ejecuta DDL: incluso ADD COLUMN IF NOT EXISTS pide AccessExclusiveLock
 * y puede bloquear todas las lecturas detrás de una transacción abierta.
 *
 * BACKFILL: un producto que ya existía tiene su stock en
 * `cantidad_disponible` sin desglosar. Todo eso se toma como stock de
 * SALÓN, que es la misma convención que usa
 * productoVariante.service.normalizarStock cuando no viene desglose
 * ("si no trae desglose, ese total se toma como stock de salón").
 *
 * Es la suposición conservadora: dar por sentado que la mercadería está a
 * mano no bloquea ninguna venta, mientras que ponerla toda en depósito
 * dejaría el salón en cero y dispararía alertas de reposición falsas en
 * todo el catálogo el primer día.
 */
async function migrarStockSalonDeposito() {
  const [columnas] = await sequelize.query(`
    SELECT attname FROM pg_attribute
    WHERE attrelid = 'productos'::regclass AND attnum > 0 AND NOT attisdropped
  `);
  const existentes = new Set(columnas.map(c => c.attname));
  const definiciones = {
    stock_salon: 'INTEGER NOT NULL DEFAULT 0',
    stock_deposito: 'INTEGER NOT NULL DEFAULT 0',
    stock_minimo_salon: 'INTEGER',
  };
  const faltantes = Object.keys(definiciones).filter(c => !existentes.has(c));
  if (!faltantes.length) return 0;

  return sequelize.transaction(async transaction => {
    // Acotado a esta transacción: un arranque no deja DDL esperando minutos.
    await sequelize.query("SET LOCAL lock_timeout = '3s'", { transaction });
    await sequelize.query("SET LOCAL statement_timeout = '30s'", { transaction });
    for (const columna of faltantes) {
      await sequelize.query(`ALTER TABLE "productos" ADD COLUMN IF NOT EXISTS "${columna}" ${definiciones[columna]}`, { transaction });
    }
    if (!faltantes.includes('stock_salon') && !faltantes.includes('stock_deposito')) return 0;
    const [, meta] = await sequelize.query(`
      UPDATE "productos"
      SET "stock_salon" = "cantidad_disponible"
      WHERE "stock_salon" = 0 AND "stock_deposito" = 0 AND "cantidad_disponible" > 0
    `, { transaction });
    return meta ? meta.rowCount : 0;
  });
}

module.exports = { migrarStockSalonDeposito };
