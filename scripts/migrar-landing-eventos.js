const { sequelize } = require('../src/models');

/**
 * Mismo patrón que migrar-envios.js: idempotente y corre en cada arranque,
 * porque sequelize.sync() va con alter:false y no toca tablas existentes.
 *
 * Agrega landing_eventos.event_id + el índice único que deduplica eventos
 * repetidos (doble clic, reintento del navegador, reenvío del mismo body).
 *
 * A propósito NO hace backfill del event_id que ya está dentro de payload en
 * las filas viejas: si entre esas filas hubiera duplicados —justamente lo que
 * este índice viene a impedir— la creación del índice fallaría y el arranque
 * quedaría en un bucle de error. Las filas previas se quedan con event_id
 * NULL (dos NULL no chocan en un índice único de Postgres) y la
 * deduplicación aplica de acá en adelante.
 */
async function migrarLandingEventos() {
  const queries = [
    'ALTER TABLE "landing_eventos" ADD COLUMN IF NOT EXISTS "event_id" VARCHAR(100)',
    'CREATE UNIQUE INDEX IF NOT EXISTS "landing_eventos_landing_event_unico" ON "landing_eventos" ("landing_id", "event_id")',
  ];

  for (const q of queries) {
    await sequelize.query(q);
  }
}

module.exports = { migrarLandingEventos };
