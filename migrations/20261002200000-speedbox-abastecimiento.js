'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    const db = queryInterface.sequelize;
    await db.transaction(async transaction => {
      await db.query('SELECT pg_advisory_xact_lock(84271007)', { transaction });
      await db.query('LOCK TABLE inventario_ubicaciones IN SHARE ROW EXCLUSIVE MODE', { transaction });
      const [duplicates] = await db.query(`SELECT usuario_id, producto_id, variante_id, deposito_id
        FROM inventario_ubicaciones GROUP BY usuario_id, producto_id, variante_id, deposito_id
        HAVING COUNT(*) > 1 LIMIT 1`, { transaction });
      if (duplicates.length) throw new Error('Inventario duplicado por propietario y ubicacion: auditar filas antes de aplicar la migracion. No se suma stock automaticamente.');
      await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_inventario_propietario_variante
        ON inventario_ubicaciones (usuario_id, producto_id, variante_id, deposito_id) WHERE variante_id IS NOT NULL`, { transaction });
      await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_inventario_propietario_simple
        ON inventario_ubicaciones (usuario_id, producto_id, deposito_id) WHERE variante_id IS NULL`, { transaction });
      await db.query('DROP INDEX IF EXISTS idx_inventario_ubicacion_unica', { transaction });
      const [stateColumns] = await db.query(`SELECT character_maximum_length FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'envios' AND column_name = 'abastecimiento_estado'`, { transaction });
      if (stateColumns[0]?.character_maximum_length != null && stateColumns[0].character_maximum_length < 60) {
        await db.query('ALTER TABLE envios ALTER COLUMN abastecimiento_estado TYPE VARCHAR(60)', { transaction });
      }
      const columns = await queryInterface.describeTable('speedbox_eventos', { transaction });
      if (!columns.conciliacion) await queryInterface.addColumn('speedbox_eventos', 'conciliacion', {
        type: Sequelize.JSONB, allowNull: true }, { transaction });
    });
  },
  async down() {
    throw new Error('Rollback requiere auditoria: el indice anterior no admite varios propietarios.');
  },
};
