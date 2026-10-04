'use strict';
module.exports = {
  async up(qi, S) {
    await qi.sequelize.transaction(async transaction => {
      const tables = await qi.showAllTables({ transaction });
      const dates = { created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false } };
      if (!tables.includes('raha_solicitudes')) await qi.createTable('raha_solicitudes', {
        id: { type: S.INTEGER, primaryKey: true, autoIncrement: true },
        usuario_id: { type: S.INTEGER, allowNull: false, unique: true, references: { model: 'usuarios', key: 'id' }, onDelete: 'RESTRICT' },
        tienda_id: { type: S.INTEGER, allowNull: false, references: { model: 'tiendas', key: 'id' }, onDelete: 'RESTRICT' },
        inquilino_id: { type: S.INTEGER, allowNull: false },
        estado: { type: S.STRING(30), allowNull: false, defaultValue: 'borrador' },
        datos: { type: S.JSONB, allowNull: false, defaultValue: {} },
        historial: { type: S.JSONB, allowNull: false, defaultValue: [] },
        version: { type: S.INTEGER, allowNull: false, defaultValue: 0 }, enviado_at: { type: S.DATE }, ...dates,
      }, { transaction });
      if (!tables.includes('raha_documentos')) await qi.createTable('raha_documentos', {
        id: { type: S.INTEGER, primaryKey: true, autoIncrement: true },
        solicitud_id: { type: S.INTEGER, allowNull: false, references: { model: 'raha_solicitudes', key: 'id' }, onDelete: 'CASCADE' },
        tipo: { type: S.STRING(30), allowNull: false }, nombre: { type: S.STRING(180), allowNull: false },
        storage_key: { type: S.STRING(200), allowNull: false }, storage_backend: { type: S.STRING(20), allowNull: false },
        mime: { type: S.STRING(80), allowNull: false }, size: { type: S.INTEGER, allowNull: false },
        sha256: { type: S.STRING(64), allowNull: false }, ...dates,
      }, { transaction });
      await qi.sequelize.query('CREATE INDEX IF NOT EXISTS raha_solicitudes_inquilino_id_estado ON raha_solicitudes (inquilino_id, estado)', { transaction });
      await qi.sequelize.query('CREATE INDEX IF NOT EXISTS raha_documentos_solicitud_id ON raha_documentos (solicitud_id)', { transaction });
    });
  },
  async down(qi) { await qi.dropTable('raha_documentos'); await qi.dropTable('raha_solicitudes'); },
};
