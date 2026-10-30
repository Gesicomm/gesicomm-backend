'use strict';

async function up(qi, S) {
  const transaction = await qi.sequelize.transaction();
  try {
    await qi.sequelize.query('SELECT pg_advisory_xact_lock(84271010)', { transaction });
    const tables = await qi.showAllTables({ transaction });
    const timestamps = {
      created_at: { type: S.DATE, allowNull: false, defaultValue: S.fn('NOW') },
      updated_at: { type: S.DATE, allowNull: false, defaultValue: S.fn('NOW') },
    };
    const definitions = {
      integracion_credenciales: {
        id: { type: S.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
        inquilino_id: { type: S.INTEGER, allowNull: false },
        // Una credencial de PROVEEDOR no tiene tienda ni usuario: lo que
        // manda entra al catálogo global, que ve todo comercio (igual que
        // los productos del administrador). Una credencial de TIENDA, en
        // cambio, escribe solo en el catálogo de ese comercio. Por eso las
        // tres columnas son nullable y `proveedor_id` decide cuál es cuál.
        proveedor_id: { type: S.INTEGER, allowNull: true, references: { model: 'proveedores', key: 'id' } },
        tienda_id: { type: S.INTEGER, allowNull: true, references: { model: 'tiendas', key: 'id' }, onDelete: 'CASCADE' },
        usuario_id: { type: S.INTEGER, allowNull: true, references: { model: 'usuarios', key: 'id' } },
        nombre: { type: S.STRING(150), allowNull: false },
        codigo: { type: S.STRING(40), allowNull: false },
        api_key_hash: { type: S.STRING(64), allowNull: false },
        api_key_prefix: { type: S.STRING(16), allowNull: false },
        activo: { type: S.BOOLEAN, allowNull: false, defaultValue: true },
        ultima_actividad_at: { type: S.DATE, allowNull: true },
        creado_por: { type: S.INTEGER, allowNull: true, references: { model: 'usuarios', key: 'id' } },
        ...timestamps,
      },
      integracion_productos: {
        id: { type: S.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
        integracion_id: { type: S.INTEGER, allowNull: false, references: { model: 'integracion_credenciales', key: 'id' }, onDelete: 'CASCADE' },
        producto_id: { type: S.INTEGER, allowNull: false, references: { model: 'productos', key: 'id' }, onDelete: 'CASCADE' },
        sku_externo: { type: S.STRING(100), allowNull: false },
        ...timestamps,
      },
      integracion_eventos: {
        id: { type: S.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
        integracion_id: { type: S.INTEGER, allowNull: false, references: { model: 'integracion_credenciales', key: 'id' }, onDelete: 'CASCADE' },
        event_key: { type: S.STRING(180), allowNull: false },
        tipo: { type: S.STRING(40), allowNull: false },
        sku_externo: { type: S.STRING(100), allowNull: true },
        producto_id: { type: S.INTEGER, allowNull: true },
        estado: { type: S.STRING(20), allowNull: false, defaultValue: 'procesado' },
        detalle: { type: S.TEXT, allowNull: true },
        payload: { type: S.JSONB, allowNull: false },
        ...timestamps,
      },
    };
    for (const [name, columns] of Object.entries(definitions)) {
      if (!tables.includes(name)) await qi.createTable(name, columns, { transaction });
    }
    // La tabla de credenciales ya existe en instalaciones anteriores.
    // createTable no la modifica, así que agregar el vínculo por separado.
    const columnasCredenciales = await qi.describeTable('integracion_credenciales', { transaction });
    if (!columnasCredenciales.proveedor_id) {
      await qi.addColumn('integracion_credenciales', 'proveedor_id', {
        type: S.INTEGER, allowNull: true, references: { model: 'proveedores', key: 'id' },
      }, { transaction });
    }
    if (columnasCredenciales.tienda_id?.allowNull === false) {
      await qi.sequelize.query('ALTER TABLE integracion_credenciales ALTER COLUMN tienda_id DROP NOT NULL', { transaction });
    }
    if (columnasCredenciales.usuario_id?.allowNull === false) {
      await qi.sequelize.query('ALTER TABLE integracion_credenciales ALTER COLUMN usuario_id DROP NOT NULL', { transaction });
    }
    // Logo chico del proveedor: es lo que la tarjeta del producto muestra
    // en Mi catálogo para reconocer de dónde viene cada producto.
    const columnasProveedores = await qi.describeTable('proveedores', { transaction });
    if (!columnasProveedores.logo_url) {
      await qi.addColumn('proveedores', 'logo_url', { type: S.STRING(500), allowNull: true }, { transaction });
    }
    for (const [table, fields, unique] of [
      ['integracion_credenciales', ['api_key_hash'], true],
      ['integracion_credenciales', ['codigo'], true],
      ['integracion_credenciales', ['tienda_id'], false],
      ['integracion_credenciales', ['proveedor_id'], false],
      ['integracion_productos', ['integracion_id', 'sku_externo'], true],
      ['integracion_productos', ['producto_id'], false],
      ['integracion_eventos', ['integracion_id', 'event_key'], true],
      ['integracion_eventos', ['integracion_id', 'tipo'], false],
    ]) {
      const name = `${table}_${fields.join('_')}`;
      const indexes = await qi.showIndex(table, { transaction });
      if (!indexes.some(index => index.name === name)) await qi.addIndex(table, fields, { name, unique, transaction });
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

async function down(qi) {
  await qi.sequelize.transaction(async transaction => {
    for (const table of ['integracion_eventos', 'integracion_productos', 'integracion_credenciales']) {
      await qi.dropTable(table, { transaction });
    }
    const columnas = await qi.describeTable('proveedores', { transaction });
    if (columnas.logo_url) await qi.removeColumn('proveedores', 'logo_url', { transaction });
  });
}

module.exports = { up, down };
