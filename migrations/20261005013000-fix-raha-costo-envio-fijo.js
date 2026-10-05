'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('combo_configuraciones');
    if (!columns.raha_costo_envio) return;

    await queryInterface.changeColumn('combo_configuraciones', 'raha_costo_envio', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 30000,
    });

    await queryInterface.sequelize.query(`
      UPDATE combo_configuraciones
      SET raha_costo_envio = 30000
      WHERE raha_costo_envio IS NULL OR raha_costo_envio <> 30000
    `);
  },

  async down(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('combo_configuraciones');
    if (!columns.raha_costo_envio) return;

    await queryInterface.changeColumn('combo_configuraciones', 'raha_costo_envio', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    });
  },
};
