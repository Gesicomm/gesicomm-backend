'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE public.whatsapp_flujo_fases
      SET estado_activador = COALESCE(estado_activador, transicion_estado_hasta,
        CASE accion_operativa
          WHEN 'PREPARAR_PEDIDO' THEN 'Preparado'
          WHEN 'DESPACHAR_PEDIDO' THEN 'Despachado'
          WHEN 'AVISO_EN_CAMINO' THEN 'Despachado'
        END),
        accion_operativa = NULL, transicion_estado_desde = NULL, transicion_estado_hasta = NULL
      WHERE accion_operativa IS NOT NULL OR transicion_estado_desde IS NOT NULL OR transicion_estado_hasta IS NOT NULL;
    `);
  },

  // La conversión no borra fases ni mensajes; revertirla no vuelve a habilitar
  // cambios logísticos por envío de mensajes.
  async down() {},
};
