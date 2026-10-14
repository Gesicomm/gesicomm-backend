'use strict';

async function up(qi, S) {
  await qi.sequelize.transaction(async transaction => {
    const columns = await qi.describeTable('speedbox_tiendas', { transaction });
    if (!columns.gesicom_tienda_id) {
      await qi.addColumn('speedbox_tiendas', 'gesicom_tienda_id', {
        type: S.INTEGER,
        allowNull: true,
        references: { model: 'tiendas', key: 'id' },
      }, { transaction });
    }

    await qi.sequelize.query(`
      UPDATE speedbox_tiendas st
      SET gesicom_tienda_id = primera_tienda.id
      FROM (
        SELECT DISTINCT ON (usuario_id) usuario_id, id
        FROM tiendas
        ORDER BY usuario_id, id
      ) primera_tienda
      WHERE st.gesicom_tienda_id IS NULL
        AND primera_tienda.usuario_id = st.usuario_id
    `, { transaction });

    const indexes = await qi.showIndex('speedbox_tiendas', { transaction });
    if (indexes.some(index => index.name === 'speedbox_tiendas_usuario_id_environment')) {
      await qi.removeIndex('speedbox_tiendas', 'speedbox_tiendas_usuario_id_environment', { transaction });
    }
    if (!indexes.some(index => index.name === 'speedbox_tiendas_usuario_id_gesicom_tienda_id_environment')) {
      await qi.addIndex('speedbox_tiendas', ['usuario_id', 'gesicom_tienda_id', 'environment'], {
        name: 'speedbox_tiendas_usuario_id_gesicom_tienda_id_environment',
        unique: true,
        transaction,
      });
    }
  });
}

async function down(qi) {
  await qi.sequelize.transaction(async transaction => {
    const indexes = await qi.showIndex('speedbox_tiendas', { transaction });
    if (indexes.some(index => index.name === 'speedbox_tiendas_usuario_id_gesicom_tienda_id_environment')) {
      await qi.removeIndex('speedbox_tiendas', 'speedbox_tiendas_usuario_id_gesicom_tienda_id_environment', { transaction });
    }
    if (!indexes.some(index => index.name === 'speedbox_tiendas_usuario_id_environment')) {
      await qi.addIndex('speedbox_tiendas', ['usuario_id', 'environment'], {
        name: 'speedbox_tiendas_usuario_id_environment',
        unique: true,
        transaction,
      });
    }
  });
}

module.exports = { up, down };
