'use strict';

async function up(qi, S) {
  await qi.sequelize.transaction(async transaction => {
    const tables = await qi.showAllTables({ transaction });
    if (!tables.includes('speedbox_tiendas')) return;
    const columns = await qi.describeTable('speedbox_tiendas', { transaction });
    if (!columns.public_key) {
      await qi.addColumn('speedbox_tiendas', 'public_key', { type: S.STRING(255), allowNull: true }, { transaction });
    }
    if (!columns.private_key) {
      await qi.addColumn('speedbox_tiendas', 'private_key', { type: S.TEXT, allowNull: true }, { transaction });
    }
  });
}

async function down(qi) {
  await qi.sequelize.transaction(async transaction => {
    const tables = await qi.showAllTables({ transaction });
    if (!tables.includes('speedbox_tiendas')) return;
    const columns = await qi.describeTable('speedbox_tiendas', { transaction });
    if (columns.private_key) await qi.removeColumn('speedbox_tiendas', 'private_key', { transaction });
    if (columns.public_key) await qi.removeColumn('speedbox_tiendas', 'public_key', { transaction });
  });
}

module.exports = { up, down };
