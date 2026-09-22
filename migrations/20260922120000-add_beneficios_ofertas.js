'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE ofertas_producto
        ADD COLUMN IF NOT EXISTS beneficios JSONB NOT NULL DEFAULT '[]'::jsonb;

      COMMENT ON COLUMN ofertas_producto.beneficios IS
        'Checks/beneficios visibles en las ofertas de checkout.';
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE ofertas_producto
        DROP COLUMN IF EXISTS beneficios;
    `);
  }
};
