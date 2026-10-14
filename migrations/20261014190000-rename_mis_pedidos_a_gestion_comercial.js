'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE public.gsql_modulos
      SET etiqueta = 'Gestión Comercial'
      WHERE menu_key = 'mis-pedidos';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE public.gsql_modulos
      SET etiqueta = 'Pedidos'
      WHERE menu_key = 'mis-pedidos';
    `);
  },
};
