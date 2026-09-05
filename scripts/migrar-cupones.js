'use strict';

const sequelize = require('../src/config/database');

/**
 * Crea las tablas de cupones si no existen. Idempotente: se ejecuta en
 * cada arranque (ver server.js) y no hace nada si ya están.
 *
 * Se escribe a mano en vez de dejarlo en manos de sequelize.sync({alter})
 * por la misma razón que el resto de las migraciones del proyecto: sync
 * con alter sobre la base real puede reescribir columnas que no tocamos.
 */
async function migrarCupones() {
  const queries = [
    `CREATE TABLE IF NOT EXISTS "cupones" (
      "id" SERIAL PRIMARY KEY,
      "inquilino_id" INTEGER NOT NULL,
      "usuario_id" INTEGER NOT NULL,
      "codigo" VARCHAR(40) NOT NULL,
      "descuento_porcentaje" DECIMAL(5,2) NOT NULL,
      "alcance" VARCHAR(20) NOT NULL DEFAULT 'tienda',
      "fecha_vencimiento" DATE,
      "max_usos" INTEGER,
      "usos" INTEGER NOT NULL DEFAULT 0,
      "activo" BOOLEAN NOT NULL DEFAULT true,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )`,

    // El código es único por comercio, no global: dos tiendas distintas
    // pueden tener su propio "VERANO20" sin pisarse.
    `CREATE UNIQUE INDEX IF NOT EXISTS "cupones_usuario_codigo"
       ON "cupones" ("usuario_id", "codigo")`,
    `CREATE INDEX IF NOT EXISTS "cupones_inquilino" ON "cupones" ("inquilino_id")`,

    `CREATE TABLE IF NOT EXISTS "cupon_productos" (
      "id" SERIAL PRIMARY KEY,
      "cupon_id" INTEGER NOT NULL REFERENCES "cupones"("id") ON DELETE CASCADE,
      "producto_id" INTEGER NOT NULL REFERENCES "productos"("id") ON DELETE CASCADE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "cupon_productos_unico"
       ON "cupon_productos" ("cupon_id", "producto_id")`,
    `CREATE INDEX IF NOT EXISTS "cupon_productos_producto"
       ON "cupon_productos" ("producto_id")`,

    // Qué cupón usó cada pedido — para poder auditar después "¿cuánto me
    // costó esta promoción?" sin tener que adivinarlo desde el monto.
    `ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "cupon_id" INTEGER
       REFERENCES "cupones"("id") ON DELETE SET NULL`,
    `ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "cupon_codigo" VARCHAR(40)`,
    `ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "cupon_descuento" INTEGER NOT NULL DEFAULT 0`,
  ];

  for (const q of queries) {
    await sequelize.query(q);
  }
}

module.exports = { migrarCupones };
