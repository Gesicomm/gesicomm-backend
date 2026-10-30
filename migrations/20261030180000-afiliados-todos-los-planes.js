'use strict';

module.exports = {
  async up(qi) {
    await qi.sequelize.query(`
      UPDATE public.gsql_modulos
      SET requiere_plan = NULL, visible = true
      WHERE modulo_key = 'afiliados';
    `);
  },
  async down(qi) {
    await qi.sequelize.query(`
      UPDATE public.gsql_modulos
      SET requiere_plan = 'founders'
      WHERE modulo_key = 'afiliados';
    `);
  },
};
