'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('combo_configuraciones');
    if (!columns.raha_cpa_porcentaje) {
      await queryInterface.addColumn('combo_configuraciones', 'raha_cpa_porcentaje', {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 20.00,
      });
    }
    if (!columns.raha_costo_envio) {
      await queryInterface.addColumn('combo_configuraciones', 'raha_costo_envio', {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      });
    }
    if (!columns.raha_costo_confirmacion) {
      await queryInterface.addColumn('combo_configuraciones', 'raha_costo_confirmacion', {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      });
    }
    if (!columns.raha_costo_empaque) {
      await queryInterface.addColumn('combo_configuraciones', 'raha_costo_empaque', {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      });
    }
  },

  async down(queryInterface) {
    const columns = await queryInterface.describeTable('combo_configuraciones');
    if (columns.raha_costo_empaque) await queryInterface.removeColumn('combo_configuraciones', 'raha_costo_empaque');
    if (columns.raha_costo_confirmacion) await queryInterface.removeColumn('combo_configuraciones', 'raha_costo_confirmacion');
    if (columns.raha_costo_envio) await queryInterface.removeColumn('combo_configuraciones', 'raha_costo_envio');
    if (columns.raha_cpa_porcentaje) await queryInterface.removeColumn('combo_configuraciones', 'raha_cpa_porcentaje');
  },
};
