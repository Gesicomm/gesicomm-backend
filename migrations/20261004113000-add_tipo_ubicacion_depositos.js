'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.depositos
        ADD COLUMN IF NOT EXISTS tipo_ubicacion VARCHAR(20) NOT NULL DEFAULT 'DEPOSITO';

      ALTER TABLE public.depositos
        DROP CONSTRAINT IF EXISTS depositos_tipo_ubicacion_check;

      ALTER TABLE public.depositos
        ADD CONSTRAINT depositos_tipo_ubicacion_check
        CHECK (tipo_ubicacion IN ('SALON', 'DEPOSITO', 'FULFILLMENT'));

      UPDATE public.depositos
      SET tipo_ubicacion = CASE
        WHEN alcance = 'GESICOMM' THEN 'FULFILLMENT'
        ELSE COALESCE(NULLIF(tipo_ubicacion, ''), 'DEPOSITO')
      END;

      COMMENT ON COLUMN public.depositos.tipo_ubicacion IS
        'Función operativa de la ubicación: SALON, DEPOSITO o FULFILLMENT. Distinto de alcance, que indica quién opera la ubicación.';

      CREATE INDEX IF NOT EXISTS idx_depositos_tipo_ubicacion
        ON public.depositos (tipo_ubicacion);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS idx_depositos_tipo_ubicacion;
      ALTER TABLE public.depositos DROP CONSTRAINT IF EXISTS depositos_tipo_ubicacion_check;
      ALTER TABLE public.depositos DROP COLUMN IF EXISTS tipo_ubicacion;
    `);
  },
};
