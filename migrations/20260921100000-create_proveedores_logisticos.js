'use strict';

/**
 * `proveedores_logisticos`: los operadores de la red de Gesicomm.
 *
 * No es un courier con otro nombre. Un courier es el repartidor que un
 * comercio configura para entregar SUS pedidos a SUS clientes. Un proveedor
 * logístico mueve mercadería dentro de la red —del proveedor al centro, entre
 * centros, del centro al depósito del comercio— y eventualmente hace última
 * milla. Una transportadora con cross-docking y almacenamiento no entra en el
 * molde de "courier con zonas".
 *
 * Sin `usuario_id` a propósito: un proveedor de la red no pertenece a ningún
 * comercio. Esa es justamente la diferencia con `couriers`.
 */
const CAPACIDADES = [
  'RETIRO_EN_PROVEEDOR',
  'CROSS_DOCKING',
  'ALMACENAMIENTO',
  'TRASLADO_ENTRE_CENTROS',
  'ULTIMA_MILLA',
];

// NO tocar esta lista: esta migración ya corrió. Las capacidades y tipos que
// se sumaron después viven en 20260921110000-ampliar_capacidades_proveedor.js.

module.exports = {
  async up(queryInterface) {
    const lista = CAPACIDADES.map((c) => `'${c}'`).join(', ');

    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS public.proveedores_logisticos (
        id           SERIAL PRIMARY KEY,
        nombre       VARCHAR(150) NOT NULL,
        tipo         VARCHAR(30)  NOT NULL DEFAULT 'TRANSPORTADORA',
        contacto     VARCHAR(150),
        telefono     VARCHAR(50),
        email        VARCHAR(150),
        capacidades  TEXT[] NOT NULL DEFAULT '{}',
        activo       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE public.proveedores_logisticos
        DROP CONSTRAINT IF EXISTS proveedores_logisticos_tipo_check;
      ALTER TABLE public.proveedores_logisticos
        ADD CONSTRAINT proveedores_logisticos_tipo_check
        CHECK (tipo IN ('TRANSPORTADORA', 'COURIER', 'FLOTA_PROPIA'));

      -- Subconjunto, no pertenencia elemento a elemento: Postgres garantiza
      -- que no entre una capacidad inventada. Los repetidos los evita la
      -- aplicación, porque <@ los acepta sin chistar.
      ALTER TABLE public.proveedores_logisticos
        DROP CONSTRAINT IF EXISTS proveedores_logisticos_capacidades_check;
      ALTER TABLE public.proveedores_logisticos
        ADD CONSTRAINT proveedores_logisticos_capacidades_check
        CHECK (capacidades <@ ARRAY[${lista}]::TEXT[]);

      COMMENT ON TABLE public.proveedores_logisticos IS
        'Operadores de la red logística de Gesicomm. No son couriers de un comercio: no tienen usuario_id y se administran desde Fulfillment.';

      CREATE INDEX IF NOT EXISTS idx_proveedores_logisticos_activo
        ON public.proveedores_logisticos (activo) WHERE activo = TRUE;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS public.proveedores_logisticos;
    `);
  },
};
