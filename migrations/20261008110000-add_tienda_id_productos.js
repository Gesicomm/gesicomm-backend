'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn('productos', 'tienda_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'tiendas', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Tienda dueña del producto cuando lo carga un comercio. Nullable para catálogo global/admin y filas antiguas.',
      }, { transaction });

      await queryInterface.addIndex('productos', ['tienda_id'], {
        name: 'productos_tienda_id_idx',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex('productos', 'productos_tienda_id_idx', { transaction });
      await queryInterface.removeColumn('productos', 'tienda_id', { transaction });
    });
  },
};
