'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE landing_items
        ADD COLUMN IF NOT EXISTS precio_ancla INTEGER DEFAULT NULL;

      COMMENT ON COLUMN landing_items.precio_ancla IS
        'Precio tachado configurado por el usuario para este item en esta landing';
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE landing_items
        DROP COLUMN IF EXISTS precio_ancla;
    `);
  }
};
