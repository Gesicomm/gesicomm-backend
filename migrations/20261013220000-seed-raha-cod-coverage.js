'use strict';

/**
 * Cobertura comercial RAHA/Rajá para COD.
 *
 * La pantalla que ve el comercio se vende como Gesicom-RAHA, así que estas
 * tarifas son la promesa comercial publicada: sólo las ciudades de la pieza
 * provista y tres tramos mensuales de pedidos contra entrega.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$
      DECLARE
        v_provider_id INTEGER;
      BEGIN
        SELECT id INTO v_provider_id
        FROM public.proveedores_logisticos
        WHERE LOWER(nombre) LIKE '%raha%'
           OR LOWER(nombre) LIKE '%raja%'
           OR LOWER(nombre) LIKE '%rajá%'
        ORDER BY id
        LIMIT 1;

        IF v_provider_id IS NULL THEN
          INSERT INTO public.proveedores_logisticos
            (nombre, tipo, capacidades, activo, created_at, updated_at)
          VALUES
            ('RAHA', 'OPERADOR_ULTIMA_MILLA', ARRAY['ULTIMA_MILLA']::TEXT[], TRUE, NOW(), NOW())
          RETURNING id INTO v_provider_id;
        END IF;

        UPDATE public.proveedores_logisticos
        SET
          nombre = CASE WHEN TRIM(COALESCE(nombre, '')) = '' THEN 'RAHA' ELSE nombre END,
          tipo = 'OPERADOR_ULTIMA_MILLA',
          capacidades = ARRAY(
            SELECT DISTINCT unnest(COALESCE(capacidades, '{}'::TEXT[]) || ARRAY['ULTIMA_MILLA']::TEXT[])
          ),
          activo = TRUE,
          updated_at = NOW()
        WHERE id = v_provider_id;

        INSERT INTO public.centro_proveedor_logistico
          (centro_id, proveedor_logistico_id, prioridad, created_at, updated_at)
        SELECT d.id, v_provider_id, 0, NOW(), NOW()
        FROM public.depositos d
        WHERE d.alcance = 'GESICOMM'
          AND d.activo = TRUE
        ON CONFLICT (centro_id, proveedor_logistico_id) DO NOTHING;

        DELETE FROM public.delivery_zona_tarifas
        WHERE proveedor_logistico_id = v_provider_id;

        INSERT INTO public.delivery_zona_tarifas
          (usuario_id, courier_id, proveedor_logistico_id, centro_id,
           departamento, ciudad, tipo_pago, rango_min, rango_max, costo,
           activo, tipo_cobertura, ciudad_id, departamento_id, pais_id,
           created_at, updated_at)
        WITH destinos(departamento, ciudad) AS (
          VALUES
            ('Asunción', 'Asunción'),
            ('Central', 'Lambaré'),
            ('Central', 'Fernando de la Mora'),
            ('Central', 'Luque'),
            ('Central', 'Mariano Roque Alonso'),
            ('Central', 'Limpio'),
            ('Central', 'Areguá'),
            ('Central', 'Itauguá'),
            ('Central', 'Capiatá'),
            ('Central', 'San Lorenzo'),
            ('Central', 'Villeta'),
            ('Central', 'Guarambaré'),
            ('Central', 'Julián Augusto Saldívar'),
            ('Central', 'Ypané'),
            ('Central', 'Ñemby'),
            ('Central', 'San Antonio'),
            ('Central', 'Villa Elisa'),
            ('Alto Paraná', 'Ciudad del Este'),
            ('Alto Paraná', 'Presidente Franco'),
            ('Alto Paraná', 'Hernandarias'),
            ('Alto Paraná', 'Minga Guazú'),
            ('Caaguazú', 'Coronel Oviedo'),
            ('Concepción', 'Concepción')
        ),
        tramos(rango_min, rango_max, costo) AS (
          VALUES
            (1, 500, 30000),
            (501, 750, 29000),
            (751, 1000, 27000)
        )
        SELECT
          NULL,
          NULL,
          v_provider_id,
          centro.id,
          dep.nombre,
          ciudad.nombre,
          'Al Recibir',
          tramos.rango_min,
          tramos.rango_max,
          tramos.costo,
          TRUE,
          'CIUDAD',
          ciudad.id,
          dep.id,
          dep.pais_id,
          NOW(),
          NOW()
        FROM public.depositos centro
        CROSS JOIN destinos
        INNER JOIN public.departamentos dep
          ON dep.nombre = destinos.departamento
        INNER JOIN public.ciudades ciudad
          ON ciudad.departamento_id = dep.id
         AND ciudad.nombre = destinos.ciudad
        CROSS JOIN tramos
        WHERE centro.alcance = 'GESICOMM'
          AND centro.activo = TRUE;

        INSERT INTO public.delivery_zona_tarifas
          (usuario_id, courier_id, proveedor_logistico_id, centro_id,
           departamento, ciudad, tipo_pago, rango_min, rango_max, costo,
           activo, tipo_cobertura, ciudad_id, departamento_id, pais_id,
           created_at, updated_at)
        SELECT
          NULL,
          NULL,
          v_provider_id,
          centro.id,
          'Encomienda',
          'Otras ciudades por encomienda',
          'Al Recibir',
          1,
          NULL,
          35000,
          TRUE,
          'CIUDAD',
          NULL,
          NULL,
          pais.id,
          NOW(),
          NOW()
        FROM public.depositos centro
        CROSS JOIN public.paises pais
        WHERE centro.alcance = 'GESICOMM'
          AND centro.activo = TRUE
          AND pais.codigo = 'PY';
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$
      DECLARE
        v_provider_id INTEGER;
      BEGIN
        SELECT id INTO v_provider_id
        FROM public.proveedores_logisticos
        WHERE LOWER(nombre) LIKE '%raha%'
           OR LOWER(nombre) LIKE '%raja%'
           OR LOWER(nombre) LIKE '%rajá%'
        ORDER BY id
        LIMIT 1;

        IF v_provider_id IS NULL THEN
          RETURN;
        END IF;

        DELETE FROM public.delivery_zona_tarifas z
        USING public.ciudades c, public.departamentos d
        WHERE z.proveedor_logistico_id = v_provider_id
          AND z.ciudad_id = c.id
          AND c.departamento_id = d.id
          AND z.tipo_pago = 'Al Recibir'
          AND z.tipo_cobertura = 'CIUDAD'
          AND (
            (d.nombre, c.nombre) IN (
              ('Asunción', 'Asunción'),
              ('Central', 'Lambaré'),
              ('Central', 'Fernando de la Mora'),
              ('Central', 'Luque'),
              ('Central', 'Mariano Roque Alonso'),
              ('Central', 'Limpio'),
              ('Central', 'Areguá'),
              ('Central', 'Itauguá'),
              ('Central', 'Capiatá'),
              ('Central', 'San Lorenzo'),
              ('Central', 'Villeta'),
              ('Central', 'Guarambaré'),
              ('Central', 'Julián Augusto Saldívar'),
              ('Central', 'Ypané'),
              ('Central', 'Ñemby'),
              ('Central', 'San Antonio'),
              ('Central', 'Villa Elisa'),
              ('Alto Paraná', 'Ciudad del Este'),
              ('Alto Paraná', 'Presidente Franco'),
              ('Alto Paraná', 'Hernandarias'),
              ('Alto Paraná', 'Minga Guazú'),
              ('Caaguazú', 'Coronel Oviedo'),
              ('Concepción', 'Concepción')
            )
          )
          AND (
            (z.rango_min = 1 AND z.rango_max = 500 AND z.costo = 30000)
            OR (z.rango_min = 501 AND z.rango_max = 750 AND z.costo = 29000)
            OR (z.rango_min = 751 AND z.rango_max = 1000 AND z.costo = 27000)
          );

        DELETE FROM public.delivery_zona_tarifas
        WHERE proveedor_logistico_id = v_provider_id
          AND tipo_pago = 'Al Recibir'
          AND tipo_cobertura = 'CIUDAD'
          AND departamento = 'Encomienda'
          AND ciudad = 'Otras ciudades por encomienda'
          AND rango_min = 1
          AND rango_max IS NULL
          AND costo = 35000;
      END $$;
    `);
  },
};
