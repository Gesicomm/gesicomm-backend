'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tienda_fonts', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      tienda_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'tiendas', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      nombre: { type: Sequelize.STRING(120), allowNull: false },
      family: { type: Sequelize.STRING(160), allowNull: false },
      url: { type: Sequelize.STRING(700), allowNull: false },
      storage_key: { type: Sequelize.STRING(700), allowNull: false },
      mime_type: { type: Sequelize.STRING(100), allowNull: false },
      extension: { type: Sequelize.STRING(10), allowNull: false },
      size: { type: Sequelize.INTEGER, allowNull: false },
      weights: { type: Sequelize.JSON, allowNull: false, defaultValue: [400] },
      style: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'normal' },
      metadata: { type: Sequelize.JSON, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('tienda_fonts', ['tienda_id']);
    await queryInterface.addIndex('tienda_fonts', ['tienda_id', 'family']);

    await queryInterface.addColumn('tiendas', 'typography', {
      type: Sequelize.JSON,
      allowNull: false,
      defaultValue: {},
    });

    await queryInterface.addColumn('landings', 'typography', {
      type: Sequelize.JSON,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('landings', 'typography');
    await queryInterface.removeColumn('tiendas', 'typography');
    await queryInterface.dropTable('tienda_fonts');
  },
};
