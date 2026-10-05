'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.whatsapp_flujos
        ADD COLUMN IF NOT EXISTS tipo VARCHAR(40) NOT NULL DEFAULT 'CONFIRMACION_PEDIDO_WEB',
        ADD COLUMN IF NOT EXISTS activacion VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
        ADD COLUMN IF NOT EXISTS predeterminado BOOLEAN NOT NULL DEFAULT false;

      ALTER TABLE public.whatsapp_flujos
        DROP CONSTRAINT IF EXISTS whatsapp_flujos_tipo_check,
        ADD CONSTRAINT whatsapp_flujos_tipo_check
          CHECK (tipo IN ('CONFIRMACION_PEDIDO_WEB', 'VENTA_WHATSAPP', 'SEGUIMIENTO_ENVIO', 'ESCALAMIENTO_VENTAS'));

      ALTER TABLE public.whatsapp_flujos
        DROP CONSTRAINT IF EXISTS whatsapp_flujos_activacion_check,
        ADD CONSTRAINT whatsapp_flujos_activacion_check
          CHECK (activacion IN ('AUTOMATICA', 'MANUAL'));

      CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_flujos_predeterminado_tipo
        ON public.whatsapp_flujos (usuario_id, tipo)
        WHERE predeterminado = true AND activo = true;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS public.uq_whatsapp_flujos_predeterminado_tipo;
      ALTER TABLE public.whatsapp_flujos
        DROP CONSTRAINT IF EXISTS whatsapp_flujos_activacion_check,
        DROP CONSTRAINT IF EXISTS whatsapp_flujos_tipo_check,
        DROP COLUMN IF EXISTS predeterminado,
        DROP COLUMN IF EXISTS activacion,
        DROP COLUMN IF EXISTS tipo;
    `);
  },
};

