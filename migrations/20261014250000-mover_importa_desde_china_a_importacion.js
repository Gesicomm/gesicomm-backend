'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE public.gsql_modulos
      SET etiqueta = 'Importa desde China', seccion = 'IMPORTACIÓN', orden = 135, updated_at = NOW()
      WHERE modulo_key = 'importada-de-china';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE public.gsql_modulos
      SET etiqueta = 'Importada de China', seccion = 'OPERACIONES', orden = 90, updated_at = NOW()
      WHERE modulo_key = 'importada-de-china';
    `);
  },
};
