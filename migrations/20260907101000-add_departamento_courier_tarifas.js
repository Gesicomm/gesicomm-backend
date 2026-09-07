'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE courier_tarifas
      ADD COLUMN IF NOT EXISTS departamento VARCHAR(100);
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_courier_tarifas_departamento_ciudad
      ON courier_tarifas (departamento, ciudad_zona);
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS idx_courier_tarifas_departamento_ciudad;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE courier_tarifas
      DROP COLUMN IF EXISTS departamento;
    `);
  }
};
