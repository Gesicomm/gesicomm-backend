'use strict';

/**
 * Tiempo de entrega numérico.
 *
 * `tiempo_entrega_hs` es texto libre y hoy convive "24" con "En el día": así
 * no se puede ordenar, promediar ni mostrar "24–48 h" sin interpretar
 * strings en cada pantalla.
 *
 * Se agregan min/max en horas y se CONSERVA la columna vieja como legacy:
 * hay valores que no tienen traducción evidente y prefiero dejarlos sin
 * convertir antes que inventar un número sobre el que después se le prometen
 * plazos a un cliente final.
 *
 * Sólo se migran los valores inequívocos —un entero puro, con o sin "hs"—.
 * "En el día" queda sin migrar y se reporta para corrección manual: podría
 * significar 6, 12 o 24 horas según la operación, y es decisión de negocio.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.delivery_zona_tarifas
        ADD COLUMN IF NOT EXISTS tiempo_entrega_min_hs INTEGER,
        ADD COLUMN IF NOT EXISTS tiempo_entrega_max_hs INTEGER;

      COMMENT ON COLUMN public.delivery_zona_tarifas.tiempo_entrega_hs IS
        'LEGACY texto libre. La UI usa tiempo_entrega_min_hs/max_hs; esta columna sobrevive para los valores que no tienen conversión inequívoca.';

      -- Sólo enteros puros, opcionalmente con "h"/"hs"/"horas" detrás.
      UPDATE public.delivery_zona_tarifas
      SET tiempo_entrega_min_hs = (regexp_match(btrim(tiempo_entrega_hs), '^([0-9]{1,3})\\s*(h|hs|horas)?$', 'i'))[1]::int,
          tiempo_entrega_max_hs = (regexp_match(btrim(tiempo_entrega_hs), '^([0-9]{1,3})\\s*(h|hs|horas)?$', 'i'))[1]::int
      WHERE tiempo_entrega_hs IS NOT NULL
        AND btrim(tiempo_entrega_hs) ~* '^[0-9]{1,3}\\s*(h|hs|horas)?$';

      -- Rangos ya escritos como "24-48" / "24 a 48".
      UPDATE public.delivery_zona_tarifas
      SET tiempo_entrega_min_hs = (regexp_match(btrim(tiempo_entrega_hs), '^([0-9]{1,3})\\s*(?:-|–|a)\\s*([0-9]{1,3})', 'i'))[1]::int,
          tiempo_entrega_max_hs = (regexp_match(btrim(tiempo_entrega_hs), '^([0-9]{1,3})\\s*(?:-|–|a)\\s*([0-9]{1,3})', 'i'))[2]::int
      WHERE tiempo_entrega_min_hs IS NULL
        AND tiempo_entrega_hs IS NOT NULL
        AND btrim(tiempo_entrega_hs) ~* '^[0-9]{1,3}\\s*(-|–|a)\\s*[0-9]{1,3}';

      ALTER TABLE public.delivery_zona_tarifas
        DROP CONSTRAINT IF EXISTS delivery_zona_tarifas_tiempo_check;

      ALTER TABLE public.delivery_zona_tarifas
        ADD CONSTRAINT delivery_zona_tarifas_tiempo_check
        CHECK (
          (tiempo_entrega_min_hs IS NULL AND tiempo_entrega_max_hs IS NULL)
          OR (tiempo_entrega_min_hs IS NOT NULL AND tiempo_entrega_max_hs IS NOT NULL
              AND tiempo_entrega_min_hs >= 0 AND tiempo_entrega_max_hs >= tiempo_entrega_min_hs)
        );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.delivery_zona_tarifas
        DROP CONSTRAINT IF EXISTS delivery_zona_tarifas_tiempo_check,
        DROP COLUMN IF EXISTS tiempo_entrega_max_hs,
        DROP COLUMN IF EXISTS tiempo_entrega_min_hs;
    `);
  },
};
