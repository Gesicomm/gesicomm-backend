'use strict';

const TABLA = 'meta_campana_gastos';

const INDICES = [
  { name: 'meta_campana_gastos_campana_desde', fields: ['meta_campana_interna_id', 'fecha_desde'] },
  { name: 'meta_campana_gastos_usuario_rango', fields: ['usuario_id', 'fecha_desde', 'fecha_hasta'] },
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const tablas = await queryInterface.showAllTables({ transaction });
      if (!tablas.includes(TABLA)) {
        await queryInterface.createTable(TABLA, {
          id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
          inquilino_id: { type: Sequelize.INTEGER, allowNull: false },
          usuario_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'usuarios', key: 'id' },
            onDelete: 'CASCADE',
          },
          meta_campana_interna_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'meta_campanas_internas', key: 'id' },
            onDelete: 'CASCADE',
          },
          fecha_desde: { type: Sequelize.DATEONLY, allowNull: false },
          fecha_hasta: { type: Sequelize.DATEONLY, allowNull: false },
          monto: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
          nota: { type: Sequelize.TEXT, allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        }, { transaction });
      }

      const existentes = await queryInterface.showIndex(TABLA, { transaction });
      for (const indice of INDICES) {
        if (!existentes.some((i) => i.name === indice.name)) {
          await queryInterface.addIndex(TABLA, indice.fields, { name: indice.name, transaction });
        }
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable(TABLA);
  },
};
