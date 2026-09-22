'use strict';

/**
 * Catálogo geográfico: país → departamento → ciudad.
 *
 * Hasta ahora ciudad y departamento eran texto libre en cada tarifa, lo que
 * produce "San Lorenzo", "san lorenzo", "SAN LORENZO " como entidades
 * distintas y hace imposible agrupar, filtrar o cubrir bien un departamento.
 *
 * `nombre_normalizado` se guarda precalculado con la MISMA normalización que
 * usa el motor de tarifas (TarifaDeliveryService.normalizarTexto: NFD, sin
 * acentos, minúsculas, trim) para que el matching y la búsqueda no dependan
 * de cómo se escribió el nombre.
 *
 * La unicidad de ciudad es por departamento, no global: hay nombres que se
 * repiten entre departamentos y son lugares distintos.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS public.paises (
        id SERIAL PRIMARY KEY,
        codigo VARCHAR(2) NOT NULL,
        nombre VARCHAR(100) NOT NULL,
        activo BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_paises_codigo ON public.paises (codigo);

      CREATE TABLE IF NOT EXISTS public.departamentos (
        id SERIAL PRIMARY KEY,
        pais_id INTEGER NOT NULL REFERENCES public.paises(id) ON DELETE CASCADE,
        nombre VARCHAR(100) NOT NULL,
        nombre_normalizado VARCHAR(100) NOT NULL,
        activo BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_departamentos_pais_nombre
        ON public.departamentos (pais_id, nombre_normalizado);

      CREATE TABLE IF NOT EXISTS public.ciudades (
        id SERIAL PRIMARY KEY,
        departamento_id INTEGER NOT NULL REFERENCES public.departamentos(id) ON DELETE CASCADE,
        nombre VARCHAR(150) NOT NULL,
        nombre_normalizado VARCHAR(150) NOT NULL,
        activo BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_ciudades_departamento_nombre
        ON public.ciudades (departamento_id, nombre_normalizado);
      -- El matching de tarifas busca por nombre normalizado sin conocer el
      -- departamento, así que ese índice se usa solo.
      CREATE INDEX IF NOT EXISTS idx_ciudades_nombre_normalizado
        ON public.ciudades (nombre_normalizado);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS public.ciudades;
      DROP TABLE IF EXISTS public.departamentos;
      DROP TABLE IF EXISTS public.paises;
    `);
  },
};
