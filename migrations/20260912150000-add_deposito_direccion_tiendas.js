'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tiendas', 'deposito_departamento', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
    await queryInterface.addColumn('tiendas', 'deposito_ciudad', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
    await queryInterface.addColumn('tiendas', 'deposito_direccion', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
    await queryInterface.addColumn('tiendas', 'deposito_referencia', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
    await queryInterface.addColumn('tiendas', 'deposito_telefono', {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tiendas', 'deposito_telefono');
    await queryInterface.removeColumn('tiendas', 'deposito_referencia');
    await queryInterface.removeColumn('tiendas', 'deposito_direccion');
    await queryInterface.removeColumn('tiendas', 'deposito_ciudad');
    await queryInterface.removeColumn('tiendas', 'deposito_departamento');
  },
};
