'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.whatsapp_flujos
        DROP CONSTRAINT IF EXISTS whatsapp_flujos_tipo_check,
        ADD CONSTRAINT whatsapp_flujos_tipo_check
          CHECK (tipo IN ('CONFIRMACION_PEDIDO_WEB', 'VENTA_WHATSAPP', 'SEGUIMIENTO_ENVIO', 'ESCALAMIENTO_VENTAS', 'PERSONALIZADO'));

      UPDATE public.gsql_modulos
      SET etiqueta = 'Flujos de WhatsApp'
      WHERE menu_key = 'pedidos-configuracion';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE public.whatsapp_flujos
      SET tipo = 'CONFIRMACION_PEDIDO_WEB'
      WHERE tipo = 'PERSONALIZADO';

      ALTER TABLE public.whatsapp_flujos
        DROP CONSTRAINT IF EXISTS whatsapp_flujos_tipo_check,
        ADD CONSTRAINT whatsapp_flujos_tipo_check
          CHECK (tipo IN ('CONFIRMACION_PEDIDO_WEB', 'VENTA_WHATSAPP', 'SEGUIMIENTO_ENVIO', 'ESCALAMIENTO_VENTAS'));

      UPDATE public.gsql_modulos
      SET etiqueta = 'Flujos y plantillas'
      WHERE menu_key = 'pedidos-configuracion';
    `);
  },
};
