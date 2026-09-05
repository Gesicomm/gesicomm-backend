'use strict';

const sequelize = require('../src/config/database');

/**
 * Atribución de pedido → landing.
 *
 * Hasta acá un pedido de checkout público solo guardaba `origen: 'LANDING'`
 * y su canal (Web): sabía que vino de "una" landing, nunca de CUÁL. Eso hacía
 * que el embudo del dashboard pegara dos mitades con alcances distintos —
 * las visitas de UNA landing arriba, y los pedidos de TODA la tienda abajo —
 * y el resultado se leía como "0 visitas → 3 formularios", que es imposible.
 *
 * SIN BACKFILL, a propósito: los pedidos anteriores no se pueden atribuir
 * porque el dato nunca se grabó en ningún lado. Quedan en NULL y el
 * dashboard los agrupa aparte ("Sin landing"). Inventarles una landing —
 * la home actual, la más visitada — sería fabricar historia.
 *
 * ON DELETE SET NULL, no CASCADE: borrar una landing NO puede borrar ventas.
 * Los eventos de pixel sí caen con ella (landing_eventos es CASCADE) porque
 * son tráfico de esa página; el pedido es plata cobrada y sobrevive a la
 * página que lo originó, aunque pierda la atribución.
 *
 * Idempotente: corre en cada arranque y no hace nada si ya está aplicada.
 */
async function migrarLandingIdEnvios() {
  await sequelize.query(
    `ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "landing_id" INTEGER`
  );

  // La FK se agrega aparte porque ADD CONSTRAINT no tiene IF NOT EXISTS en
  // Postgres: se consulta el catálogo primero (mismo criterio que el resto
  // de las migraciones de arranque, que tienen que poder correr N veces).
  const [fk] = await sequelize.query(`
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'envios' AND constraint_name = 'envios_landing_id_fkey'
  `);
  if (!fk.length) {
    await sequelize.query(`
      ALTER TABLE "envios"
      ADD CONSTRAINT "envios_landing_id_fkey"
      FOREIGN KEY ("landing_id") REFERENCES "landings"("id")
      ON DELETE SET NULL ON UPDATE CASCADE
    `);
  }

  // El dashboard filtra por (usuario_id, landing_id) en cada carga.
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS "envios_landing_id_idx" ON "envios" ("landing_id")`
  );
}

module.exports = { migrarLandingIdEnvios };
