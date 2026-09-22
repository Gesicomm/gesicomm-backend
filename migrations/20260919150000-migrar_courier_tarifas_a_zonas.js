'use strict';

/**
 * Fase 1 de la consolidación del motor de tarifas: mueve las filas legacy de
 * `courier_tarifas` a `delivery_zona_tarifas`, que pasa a ser la única
 * fuente de verdad.
 *
 * Contexto de la auditoría previa: no hay un solo destino presente en las
 * dos tablas, así que esta migración NO resuelve conflictos ni cambia
 * ningún costo vigente — sólo rescata cobertura que hoy está enterrada. De
 * los 8 destinos con tarifa, 7 viven únicamente acá, de 3 comercios: si
 * `courier_tarifas` se borrara sin este paso, esos destinos quedarían sin
 * tarifa y caerían a costo cero para carga manual.
 *
 * `courier_tarifas` NO se elimina todavía: queda sin lecturas ni escrituras
 * y se dropea en una migración aparte, para poder revertir sin perder datos.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      INSERT INTO public.delivery_zona_tarifas
        (usuario_id, courier_id, departamento, ciudad, tipo_pago,
         rango_min, rango_max, costo, tiempo_entrega_hs, activo, created_at, updated_at)
      SELECT
        c.usuario_id,
        t.courier_id,
        NULLIF(btrim(COALESCE(t.departamento, '')), ''),
        btrim(t.ciudad_zona),
        COALESCE(NULLIF(btrim(COALESCE(t.tipo_pago, '')), ''), 'Ambos'),
        COALESCE(t.rango_min, 0),
        t.rango_max,
        COALESCE(t.costo, 0),
        NULLIF(btrim(COALESCE(t.tiempo_entrega_hs, '')), ''),
        true,
        NOW(),
        NOW()
      FROM public.courier_tarifas t
      JOIN public.couriers c ON c.id = t.courier_id
      WHERE btrim(COALESCE(t.ciudad_zona, '')) <> ''
        -- Idempotente: si la regla equivalente ya está en zonas, no se duplica.
        AND NOT EXISTS (
          SELECT 1
          FROM public.delivery_zona_tarifas z
          WHERE z.usuario_id = c.usuario_id
            AND z.courier_id IS NOT DISTINCT FROM t.courier_id
            AND lower(btrim(z.ciudad)) = lower(btrim(t.ciudad_zona))
            AND lower(btrim(COALESCE(z.departamento, ''))) = lower(btrim(COALESCE(t.departamento, '')))
            AND COALESCE(z.rango_min, 0) = COALESCE(t.rango_min, 0)
            AND z.rango_max IS NOT DISTINCT FROM t.rango_max
        );
    `);
  },

  async down(queryInterface) {
    // Saca sólo las filas que esta migración pudo haber creado: las que
    // siguen teniendo un gemelo exacto en la tabla legacy.
    await queryInterface.sequelize.query(`
      DELETE FROM public.delivery_zona_tarifas z
      USING public.courier_tarifas t
      JOIN public.couriers c ON c.id = t.courier_id
      WHERE z.usuario_id = c.usuario_id
        AND z.courier_id IS NOT DISTINCT FROM t.courier_id
        AND lower(btrim(z.ciudad)) = lower(btrim(t.ciudad_zona))
        AND lower(btrim(COALESCE(z.departamento, ''))) = lower(btrim(COALESCE(t.departamento, '')))
        AND COALESCE(z.rango_min, 0) = COALESCE(t.rango_min, 0)
        AND z.rango_max IS NOT DISTINCT FROM t.rango_max
        AND COALESCE(z.costo, 0) = COALESCE(t.costo, 0);
    `);
  },
};
