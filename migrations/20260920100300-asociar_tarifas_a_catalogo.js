'use strict';

/**
 * Asocia las tarifas al catálogo geográfico, conservando `ciudad` y
 * `departamento` como texto.
 *
 * Sólo escribe los dos casos seguros del reporte previo:
 *   MATCH_EXACTO             ciudad y departamento coinciden
 *   MATCH_UNICO_NORMALIZADO  coincide normalizado y hay UNA sola candidata
 *
 * AMBIGUO y SIN_MATCH quedan en NULL a propósito. Al correr esta migración
 * el reporte daba 2 exactos, 6 únicos y 3 sin match:
 *   "fernando"  -> parece "Fernando de la Mora", pero es un nombre parcial y
 *                  adivinarlo es inventar cobertura;
 *   "Central"   -> es un departamento usado como ciudad (dato mal cargado);
 *   "Interior"  -> no es una ciudad sino "el resto del país", un concepto que
 *                  el catálogo no representa.
 *
 * Nada de eso rompe: el motor de tarifas sigue resolviendo por texto, así que
 * esas tres coberturas siguen funcionando igual mientras se corrigen.
 *
 * La normalización SQL replica TarifaDeliveryService.normalizarTexto: sin
 * acentos (incluida ñ→n), minúsculas y trim.
 */
const NORM = (col) => `translate(lower(btrim(${col})), 'áàäâãéèëêíìïîóòöôõúùüûñ', 'aaaaaeeeeiiiiooooouuuun')`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.delivery_zona_tarifas
        ADD COLUMN IF NOT EXISTS ciudad_id INTEGER REFERENCES public.ciudades(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS departamento_id INTEGER REFERENCES public.departamentos(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_delivery_zona_tarifas_ciudad
        ON public.delivery_zona_tarifas (ciudad_id);

      COMMENT ON COLUMN public.delivery_zona_tarifas.ciudad_id IS
        'Ciudad del catálogo. NULL = la cobertura existe por texto pero no pudo asociarse con seguridad; sigue funcionando y espera corrección manual.';

      -- 1) MATCH_EXACTO: ciudad y departamento coinciden.
      UPDATE public.delivery_zona_tarifas z
      SET ciudad_id = c.id, departamento_id = d.id
      FROM public.ciudades c
      JOIN public.departamentos d ON d.id = c.departamento_id
      WHERE z.ciudad_id IS NULL
        AND c.nombre_normalizado = ${NORM('z.ciudad')}
        AND z.departamento IS NOT NULL
        AND d.nombre_normalizado = ${NORM('z.departamento')};

      -- 2) MATCH_UNICO_NORMALIZADO: una sola candidata con ese nombre.
      UPDATE public.delivery_zona_tarifas z
      SET ciudad_id = u.ciudad_id, departamento_id = u.departamento_id
      FROM (
        SELECT ${NORM('c.nombre')} AS clave,
               MIN(c.id) AS ciudad_id,
               MIN(c.departamento_id) AS departamento_id
        FROM public.ciudades c
        GROUP BY 1
        HAVING COUNT(*) = 1
      ) u
      WHERE z.ciudad_id IS NULL
        AND u.clave = ${NORM('z.ciudad')};
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS idx_delivery_zona_tarifas_ciudad;
      ALTER TABLE public.delivery_zona_tarifas
        DROP COLUMN IF EXISTS departamento_id,
        DROP COLUMN IF EXISTS ciudad_id;
    `);
  },
};
