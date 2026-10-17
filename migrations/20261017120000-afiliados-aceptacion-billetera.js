'use strict';

module.exports = {
  async up(qi, S = require('sequelize')) {
    const afiliados = await qi.describeTable('afiliados');
    if (!afiliados.terminos_version) await qi.addColumn('afiliados', 'terminos_version', { type: S.STRING(30), allowNull: true });
    if (!afiliados.terminos_aceptados_en) await qi.addColumn('afiliados', 'terminos_aceptados_en', { type: S.DATE, allowNull: true });
    const comisiones = await qi.describeTable('afiliado_comisiones');
    if (!comisiones.pagada_en) await qi.addColumn('afiliado_comisiones', 'pagada_en', { type: S.DATE, allowNull: true });
  },
  async down(qi) {
    await qi.removeColumn('afiliado_comisiones', 'pagada_en');
    await qi.removeColumn('afiliados', 'terminos_aceptados_en');
    await qi.removeColumn('afiliados', 'terminos_version');
  },
};
