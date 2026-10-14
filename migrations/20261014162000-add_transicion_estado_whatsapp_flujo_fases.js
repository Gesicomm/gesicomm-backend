'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.whatsapp_flujo_fases
        ADD COLUMN IF NOT EXISTS transicion_estado_desde VARCHAR(40) NULL,
        ADD COLUMN IF NOT EXISTS transicion_estado_hasta VARCHAR(40) NULL;

      COMMENT ON COLUMN public.whatsapp_flujo_fases.transicion_estado_desde IS
        'Estado operativo requerido para aplicar el cambio al completar la fase.';
      COMMENT ON COLUMN public.whatsapp_flujo_fases.transicion_estado_hasta IS
        'Estado operativo destino aplicado al completar la fase.';

      UPDATE public.whatsapp_flujo_fases fase
      SET
        transicion_estado_desde = CASE fase.accion_operativa
          WHEN 'PREPARAR_PEDIDO' THEN 'Confirmado'
          WHEN 'DESPACHAR_PEDIDO' THEN 'Preparado'
          ELSE fase.transicion_estado_desde
        END,
        transicion_estado_hasta = CASE fase.accion_operativa
          WHEN 'PREPARAR_PEDIDO' THEN 'Preparado'
          WHEN 'DESPACHAR_PEDIDO' THEN 'Despachado'
          ELSE fase.transicion_estado_hasta
        END
      FROM public.whatsapp_flujos flujo
      WHERE fase.flujo_id = flujo.id
        AND flujo.tipo = 'SEGUIMIENTO_ENVIO'
        AND fase.activo = true
        AND fase.accion_operativa IN ('PREPARAR_PEDIDO', 'DESPACHAR_PEDIDO')
        AND (fase.transicion_estado_desde IS NULL OR fase.transicion_estado_hasta IS NULL);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.whatsapp_flujo_fases
        DROP COLUMN IF EXISTS transicion_estado_hasta,
        DROP COLUMN IF EXISTS transicion_estado_desde;
    `);
  },
};
