'use strict';

const sequelize = require('../src/config/database');

/**
 * Tabla de intentos de entrega — un viaje del courier por fila.
 * Ver la cabecera de src/models/EnvioIntentoEntrega.js para el porqué.
 *
 * SIN BACKFILL: de los pedidos ya entregados no se puede reconstruir cuántos
 * viajes hicieron falta. El historial guarda las transiciones, pero no el
 * costo de cada viaje —que es justamente lo que no se registraba—, así que
 * inventar una fila por pedido viejo sería fabricar un costo que nadie cargó.
 * Los pedidos anteriores quedan sin desglose y su `costo_envio` sigue siendo
 * el total que se les puso en su momento.
 *
 * ON DELETE CASCADE hacia envios: el desglose no tiene sentido sin el pedido.
 * ON DELETE SET NULL hacia couriers: borrar un courier no puede borrar el
 * registro de un viaje que se pagó.
 *
 * Idempotente: corre en cada arranque.
 */
async function migrarIntentosEntrega() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS "envio_intentos_entrega" (
      "id" SERIAL PRIMARY KEY,
      "envio_id" INTEGER NOT NULL REFERENCES "envios"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      "courier_id" INTEGER REFERENCES "couriers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
      "numero" INTEGER NOT NULL,
      "resultado" VARCHAR(20) NOT NULL,
      "costo" INTEGER NOT NULL DEFAULT 0,
      "motivo" TEXT,
      "fecha_reprogramada" DATE,
      "fecha" DATE NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS "envio_intentos_entrega_envio_id" ON "envio_intentos_entrega" ("envio_id")`
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS "envio_intentos_entrega_courier_id_fecha" ON "envio_intentos_entrega" ("courier_id", "fecha")`
  );
}

module.exports = { migrarIntentosEntrega };
