'use strict';

const { migrarNumeroPedidoTienda } = require('../scripts/migrar-numero-pedido-tienda');

module.exports = {
  async up(queryInterface) {
    await migrarNumeroPedidoTienda(queryInterface.sequelize);
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.removeIndex('envios', 'uq_envios_tienda_numero_pedido', { transaction });
      await queryInterface.removeColumn('envios', 'numero_pedido_tienda', { transaction });
      await queryInterface.dropTable('pedido_tienda_counters', { transaction });
    });
  },
};
