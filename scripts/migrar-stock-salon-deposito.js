'use strict';

const sequelize = require('../src/config/database');

/**
 * Desglose de stock salón/depósito en `productos` — el mismo que las
 * variantes ya tenían (ver ProductoVariante). Idempotente: corre en cada
 * arranque y no hace nada si las columnas ya están.
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
  const queries = [
    `ALTER TABLE "productos" ADD COLUMN IF NOT EXISTS "stock_salon" INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE "productos" ADD COLUMN IF NOT EXISTS "stock_deposito" INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE "productos" ADD COLUMN IF NOT EXISTS "stock_minimo_salon" INTEGER`,
  ];
  for (const q of queries) {
    await sequelize.query(q);
  }

  // Solo toca las filas que todavía no fueron desglosadas: si salón y
  // depósito están los dos en cero pero hay stock disponible, ese producto
  // nunca pasó por acá.
  const [, meta] = await sequelize.query(`
    UPDATE "productos"
    SET "stock_salon" = "cantidad_disponible"
    WHERE "stock_salon" = 0 AND "stock_deposito" = 0 AND "cantidad_disponible" > 0
  `);
  return meta ? meta.rowCount : 0;
}

module.exports = { migrarStockSalonDeposito };
