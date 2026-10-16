'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.whatsapp_flujos
          DROP CONSTRAINT IF EXISTS whatsapp_flujos_tipo_check,
          ADD CONSTRAINT whatsapp_flujos_tipo_check
            CHECK (tipo IN ('CONFIRMACION_PEDIDO_WEB', 'VENTA_WHATSAPP', 'SEGUIMIENTO_ENVIO', 'ESCALAMIENTO_VENTAS', 'RECUPERACION_CLIENTES', 'CONSULTA_GENERAL_WHATSAPP', 'PERSONALIZADO'));
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Preserva los mensajes y el historial al retirar la etapa automática.
      await queryInterface.sequelize.query(`
        UPDATE public.whatsapp_flujos
        SET tipo = 'PERSONALIZADO', activacion = 'MANUAL', predeterminado = false
        WHERE tipo = 'CONSULTA_GENERAL_WHATSAPP';

        ALTER TABLE public.whatsapp_flujos
          DROP CONSTRAINT IF EXISTS whatsapp_flujos_tipo_check,
          ADD CONSTRAINT whatsapp_flujos_tipo_check
            CHECK (tipo IN ('CONFIRMACION_PEDIDO_WEB', 'VENTA_WHATSAPP', 'SEGUIMIENTO_ENVIO', 'ESCALAMIENTO_VENTAS', 'RECUPERACION_CLIENTES', 'PERSONALIZADO'));
      `, { transaction });
    });
  },
};
