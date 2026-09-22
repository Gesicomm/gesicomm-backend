'use strict';

/**
 * Elimina físicamente `courier_tarifas`, cerrando la consolidación del motor
 * de tarifas.
 *
 * Precondiciones, ya cumplidas en migraciones y commits anteriores:
 *  - sus 9 filas se migraron a `delivery_zona_tarifas` (20260919150000);
 *  - ningún controller ni service la lee o la escribe;
 *  - el modelo y sus asociaciones se borraron del código.
 *
 * Va en su propia migración a propósito: separar el borrado de datos del
 * cambio de código permite desplegar, mirar producción unos días y recién
 * entonces tirar la tabla. El `down` recrea la estructura pero NO las filas
 * —esas ya viven en delivery_zona_tarifas—, así que conviene correrla recién
 * cuando el flujo nuevo esté rodado.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.courier_tarifas;');
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS public.courier_tarifas (
        id SERIAL PRIMARY KEY,
        courier_id INTEGER NOT NULL REFERENCES public.couriers(id) ON DELETE CASCADE,
        ciudad_zona VARCHAR(150) NOT NULL,
        departamento VARCHAR(100),
        tipo_pago VARCHAR(50),
        rango_min INTEGER NOT NULL DEFAULT 0,
        rango_max INTEGER,
        costo INTEGER NOT NULL DEFAULT 0,
        tiempo_entrega_hs VARCHAR(50),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  },
};
