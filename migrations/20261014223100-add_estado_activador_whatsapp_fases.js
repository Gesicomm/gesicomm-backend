'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.whatsapp_flujo_fases
          ADD COLUMN IF NOT EXISTS estado_activador VARCHAR(40) NULL;

        UPDATE public.whatsapp_flujo_fases fase
        SET estado_activador = CASE
          WHEN fase.accion_operativa = 'PREPARAR_PEDIDO' OR (fase.transicion_estado_desde = 'Confirmado' AND fase.transicion_estado_hasta = 'Preparado') THEN 'Preparado'
          ELSE 'Despachado'
        END,
        accion_operativa = NULL, transicion_estado_desde = NULL, transicion_estado_hasta = NULL
        FROM public.whatsapp_flujos flujo
        WHERE fase.flujo_id = flujo.id AND flujo.tipo = 'SEGUIMIENTO_ENVIO'
          AND (fase.accion_operativa IN ('PREPARAR_PEDIDO', 'DESPACHAR_PEDIDO', 'AVISO_EN_CAMINO')
            OR (fase.transicion_estado_desde = 'Confirmado' AND fase.transicion_estado_hasta = 'Preparado')
            OR (fase.transicion_estado_desde = 'Preparado' AND fase.transicion_estado_hasta = 'Despachado'));
      `, { transaction });
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('whatsapp_flujo_fases', 'estado_activador');
  },
};
