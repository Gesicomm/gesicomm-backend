'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(`
        ALTER TABLE speedbox_pedidos
        ALTER COLUMN envio_id DROP NOT NULL
      `, { transaction });
    });
  },

  async down() {
    // No-op: RAHA supply orders are stored without envio_id.
  },
};
