'use strict';

async function up(qi, S) {
  const transaction = await qi.sequelize.transaction();
  try {
    // Also used during startup. The advisory lock serializes concurrent boots.
    await qi.sequelize.query('SELECT pg_advisory_xact_lock(84271003)', { transaction });
    const tables = await qi.showAllTables({ transaction });
    const common = {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      environment: { type: S.STRING(20), allowNull: false },
      created_at: { type: S.DATE, allowNull: false, defaultValue: S.fn('NOW') },
      updated_at: { type: S.DATE, allowNull: false, defaultValue: S.fn('NOW') },
    };
    const definitions = {
      speedbox_tiendas: { ...common,
        usuario_id: { type: S.INTEGER, allowNull: false, references: { model: 'usuarios', key: 'id' } },
        tienda_id: { type: S.STRING(100), allowNull: true }, courier_id: { type: S.INTEGER, allowNull: true, references: { model: 'couriers', key: 'id' } },
        activo: { type: S.BOOLEAN, allowNull: false, defaultValue: false }, enabled_at: { type: S.DATE, allowNull: true },
        since_at: { type: S.STRING(50), allowNull: true }, spec_verified_at: { type: S.DATE, allowNull: true },
        updates_verified_at: { type: S.DATE, allowNull: true }, webhook_verified_at: { type: S.DATE, allowNull: true },
      },
      speedbox_pedidos: { ...common,
        envio_id: { type: S.INTEGER, allowNull: false, references: { model: 'envios', key: 'id' }, onDelete: 'CASCADE' },
        usuario_id: { type: S.INTEGER, allowNull: false, references: { model: 'usuarios', key: 'id' } },
        external_order_id: { type: S.STRING(100), allowNull: false }, order_id: { type: S.STRING(100), allowNull: true },
        estado: { type: S.STRING(30), allowNull: false, defaultValue: 'pendiente' }, status: { type: S.STRING(50), allowNull: true },
        status_at: { type: S.DATE, allowNull: true }, request_payload: { type: S.JSONB, allowNull: true }, response_payload: { type: S.JSONB, allowNull: true },
        intentos: { type: S.INTEGER, allowNull: false, defaultValue: 0 }, error: { type: S.TEXT, allowNull: true }, remote_http_status: { type: S.INTEGER, allowNull: true },
      },
      speedbox_eventos: { ...common,
        event_key: { type: S.STRING(180), allowNull: false }, tipo: { type: S.STRING(100), allowNull: false },
        usuario_id: { type: S.INTEGER, allowNull: true, references: { model: 'usuarios', key: 'id' } },
        order_id: { type: S.STRING(100), allowNull: true }, tienda_id: { type: S.STRING(100), allowNull: true },
        occurred_at: { type: S.DATE, allowNull: true }, source: { type: S.STRING(20), allowNull: false },
        payload: { type: S.JSONB, allowNull: false }, estado: { type: S.STRING(30), allowNull: false, defaultValue: 'pendiente' }, detalle: { type: S.TEXT, allowNull: true },
      },
    };
    for (const [name, columns] of Object.entries(definitions)) {
      if (!tables.includes(name)) await qi.createTable(name, columns, { transaction });
    }
    for (const [table, fields, unique] of [
      ['speedbox_tiendas', ['usuario_id', 'environment'], true], ['speedbox_tiendas', ['environment', 'tienda_id'], true],
      ['speedbox_pedidos', ['environment', 'envio_id'], true], ['speedbox_pedidos', ['environment', 'order_id'], true],
      ['speedbox_eventos', ['environment', 'event_key'], true], ['speedbox_eventos', ['usuario_id', 'tipo'], false],
    ]) {
      const name = `${table}_${fields.join('_')}`;
      const indexes = await qi.showIndex(table, { transaction });
      if (!indexes.some(index => index.name === name)) await qi.addIndex(table, fields, { name, unique, transaction });
    }
    await transaction.commit();
  } catch (error) { await transaction.rollback(); throw error; }
}

module.exports = { up, async down(qi) {
  await qi.sequelize.transaction(async transaction => {
    for (const table of ['speedbox_eventos', 'speedbox_pedidos', 'speedbox_tiendas']) await qi.dropTable(table, { transaction });
  });
} };
