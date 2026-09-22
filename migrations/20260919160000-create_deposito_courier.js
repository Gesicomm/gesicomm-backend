'use strict';

/**
 * Fase 2 del motor de fulfillment: relación N:M entre depósitos y couriers.
 *
 * Un depósito puede despachar con varios couriers y un courier puede prestar
 * servicio desde varios depósitos, así que la relación no entra en ninguna de
 * las dos tablas. El costo NO vive acá: sigue en `delivery_zona_tarifas`,
 * que pertenece al courier y su cobertura. Esta tabla sólo responde "desde
 * este depósito, ¿con quién puedo despachar?".
 *
 * `couriers.alcance` distingue al proveedor logístico que ofrece Gesicomm
 * (configurado por el admin y utilizable por los comercios) del courier
 * privado de cada comercio. Hasta ahora eso era una convención implícita
 * basada en `usuario_id`; la validación de ownership al vincular necesita
 * que sea explícito.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.couriers
        ADD COLUMN IF NOT EXISTS alcance VARCHAR(20) NOT NULL DEFAULT 'PROPIO';

      ALTER TABLE public.couriers
        DROP CONSTRAINT IF EXISTS couriers_alcance_check;

      ALTER TABLE public.couriers
        ADD CONSTRAINT couriers_alcance_check CHECK (alcance IN ('GESICOMM', 'PROPIO'));

      COMMENT ON COLUMN public.couriers.alcance IS
        'PROPIO = courier privado del comercio. GESICOMM = proveedor logístico ofrecido por Gesicomm, configurado por el admin y utilizable por los comercios.';

      CREATE TABLE IF NOT EXISTS public.deposito_courier (
        id SERIAL PRIMARY KEY,
        deposito_id INTEGER NOT NULL REFERENCES public.depositos(id) ON DELETE CASCADE,
        courier_id INTEGER NOT NULL REFERENCES public.couriers(id) ON DELETE CASCADE,
        prioridad INTEGER NOT NULL DEFAULT 0,
        activo BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_deposito_courier
        ON public.deposito_courier (deposito_id, courier_id);

      CREATE INDEX IF NOT EXISTS idx_deposito_courier_courier
        ON public.deposito_courier (courier_id);

      COMMENT ON COLUMN public.deposito_courier.prioridad IS
        'Orden de preferencia al resolver el fulfillment desde este depósito. Menor = se evalúa antes.';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS public.deposito_courier;

      ALTER TABLE public.couriers DROP CONSTRAINT IF EXISTS couriers_alcance_check;
      ALTER TABLE public.couriers DROP COLUMN IF EXISTS alcance;
    `);
  },
};
