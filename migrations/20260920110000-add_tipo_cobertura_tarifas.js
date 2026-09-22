'use strict';

/**
 * Tipos de cobertura: una tarifa puede apuntar a una ciudad concreta o a un
 * "resto de".
 *
 *   CIUDAD              -> ciudad_id obligatorio
 *   RESTO_DEPARTAMENTO  -> departamento_id obligatorio, ciudad_id null
 *   RESTO_PAIS          -> pais_id obligatorio, departamento y ciudad null
 *
 * Nace de un caso real: el usuario 3 cubría "Interior" ₲30.000, que no es una
 * ciudad sino "el resto del país". Tratarlo como ciudad ficticia funcionaba
 * de casualidad —el selector del checkout se arma desde la cobertura, así que
 * el comprador veía "Interior" como si fuera una localidad— pero no se puede
 * agrupar, ni filtrar, ni razonar sobre ello.
 *
 * `tipo_cobertura` es NULLABLE a propósito: las coberturas legacy que todavía
 * no se pudieron clasificar (texto que no matchea el catálogo) quedan en NULL
 * y el CHECK no las molesta. Siguen resolviéndose por texto como siempre.
 *
 * Esta migración NO cambia el resolver: sólo clasifica. El cambio de
 * prioridad (ciudad > resto de depto > resto de país) va aparte, junto con el
 * selector de ciudad del checkout, porque ahí sí cambia lo que ve un
 * comprador.
 */
const NORM = (col) => `translate(lower(btrim(${col})), 'áàäâãéèëêíìïîóòöôõúùüûñ', 'aaaaaeeeeiiiiooooouuuun')`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.delivery_zona_tarifas
        ADD COLUMN IF NOT EXISTS tipo_cobertura VARCHAR(20),
        ADD COLUMN IF NOT EXISTS pais_id INTEGER REFERENCES public.paises(id) ON DELETE SET NULL;

      -- Toda tarifa ya asociada a una ciudad del catálogo es cobertura de ciudad.
      UPDATE public.delivery_zona_tarifas
      SET tipo_cobertura = 'CIUDAD'
      WHERE tipo_cobertura IS NULL AND ciudad_id IS NOT NULL;

      -- "Interior" = resto del país. Es la única conversión de texto que se
      -- hace acá, y sólo porque fue aprobada explícitamente como regla de
      -- negocio: cubre los destinos sin tarifa específica.
      UPDATE public.delivery_zona_tarifas z
      SET tipo_cobertura = 'RESTO_PAIS',
          pais_id = (SELECT id FROM public.paises WHERE codigo = 'PY'),
          departamento_id = NULL,
          ciudad_id = NULL
      WHERE z.tipo_cobertura IS NULL
        AND ${NORM('z.ciudad')} = 'interior';

      ALTER TABLE public.delivery_zona_tarifas
        DROP CONSTRAINT IF EXISTS delivery_zona_tarifas_tipo_cobertura_check;

      ALTER TABLE public.delivery_zona_tarifas
        ADD CONSTRAINT delivery_zona_tarifas_tipo_cobertura_check
        CHECK (
          -- legacy sin clasificar: sigue resolviéndose por texto
          tipo_cobertura IS NULL
          OR (tipo_cobertura = 'CIUDAD' AND ciudad_id IS NOT NULL)
          OR (tipo_cobertura = 'RESTO_DEPARTAMENTO' AND departamento_id IS NOT NULL AND ciudad_id IS NULL)
          OR (tipo_cobertura = 'RESTO_PAIS' AND pais_id IS NOT NULL AND departamento_id IS NULL AND ciudad_id IS NULL)
        );

      COMMENT ON COLUMN public.delivery_zona_tarifas.tipo_cobertura IS
        'CIUDAD | RESTO_DEPARTAMENTO | RESTO_PAIS. NULL = cobertura legacy por texto, pendiente de clasificar.';

      CREATE INDEX IF NOT EXISTS idx_delivery_zona_tarifas_tipo_cobertura
        ON public.delivery_zona_tarifas (tipo_cobertura);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS idx_delivery_zona_tarifas_tipo_cobertura;
      ALTER TABLE public.delivery_zona_tarifas
        DROP CONSTRAINT IF EXISTS delivery_zona_tarifas_tipo_cobertura_check,
        DROP COLUMN IF EXISTS pais_id,
        DROP COLUMN IF EXISTS tipo_cobertura;
    `);
  },
};
