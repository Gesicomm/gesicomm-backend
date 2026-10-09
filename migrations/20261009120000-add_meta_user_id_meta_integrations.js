'use strict';

// ID de usuario de Meta (app-scoped) de quien autorizó la conexión.
//
// Es lo único que trae el signed_request del Data Deletion Callback: sin esta
// columna no hay forma de saber qué filas de meta_integrations pertenecen a
// quien quitó la app desde Facebook, y el borrado quedaba manual.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('meta_integrations', 'meta_user_id', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await queryInterface.addIndex('meta_integrations', ['meta_user_id']);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('meta_integrations', ['meta_user_id']);
    await queryInterface.removeColumn('meta_integrations', 'meta_user_id');
  },
};
