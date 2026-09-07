'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE landing_items
        ADD COLUMN IF NOT EXISTS envio_incluido BOOLEAN NOT NULL DEFAULT false;

      COMMENT ON COLUMN landing_items.envio_incluido IS
        'Si true, este item se vende con delivery incluido en esta landing';
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE landing_items
        DROP COLUMN IF EXISTS envio_incluido;
    `);
  }
};
