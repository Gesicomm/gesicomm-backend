'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.whatsapp_flujo_fases
        ADD COLUMN IF NOT EXISTS accion_operativa VARCHAR(40) NULL;

      COMMENT ON COLUMN public.whatsapp_flujo_fases.accion_operativa IS
        'Accion interna estable ejecutada al completar la fase. No depende del nombre ni del orden editable.';

      UPDATE public.whatsapp_flujo_fases fase
      SET accion_operativa = CASE
        WHEN lower(fase.nombre) LIKE '%confirm%' OR lower(fase.nombre) LIKE '%prepar%' THEN 'PREPARAR_PEDIDO'
        WHEN lower(fase.nombre) LIKE '%despach%' THEN 'DESPACHAR_PEDIDO'
        WHEN lower(fase.nombre) LIKE '%camino%' THEN 'AVISO_EN_CAMINO'
        ELSE accion_operativa
      END
      FROM public.whatsapp_flujos flujo
      WHERE fase.flujo_id = flujo.id
        AND flujo.tipo = 'SEGUIMIENTO_ENVIO'
        AND fase.accion_operativa IS NULL
        AND (
          lower(fase.nombre) LIKE '%confirm%'
          OR lower(fase.nombre) LIKE '%prepar%'
          OR lower(fase.nombre) LIKE '%despach%'
          OR lower(fase.nombre) LIKE '%camino%'
        );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.whatsapp_flujo_fases
        DROP COLUMN IF EXISTS accion_operativa;
    `);
  },
};
