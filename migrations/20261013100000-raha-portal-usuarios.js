'use strict';
// Cuentas del portal externo de Raha (/raha/login). Separadas de `usuarios`
// a proposito: la gente de Raha no es un comercio ni un admin de Gesicom.
module.exports = {
  async up(qi, S) {
    await qi.sequelize.transaction(async transaction => {
      const tables = await qi.showAllTables({ transaction });
      if (!tables.includes('raha_portal_usuarios')) await qi.createTable('raha_portal_usuarios', {
        id: { type: S.INTEGER, primaryKey: true, autoIncrement: true },
        nombre: { type: S.STRING(150), allowNull: false },
        email: { type: S.STRING(150), allowNull: false, unique: true },
        password_hash: { type: S.STRING(100), allowNull: false },
        activo: { type: S.BOOLEAN, allowNull: false, defaultValue: true },
        ultimo_acceso: { type: S.DATE },
        created_at: { type: S.DATE, allowNull: false },
        updated_at: { type: S.DATE, allowNull: false },
      }, { transaction });
    });
  },
  async down(qi) { await qi.dropTable('raha_portal_usuarios'); },
};
