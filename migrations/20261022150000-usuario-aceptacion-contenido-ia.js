'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS contenido_ia_aceptado_en TIMESTAMPTZ;');
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('usuarios', 'contenido_ia_aceptado_en');
  },
};
