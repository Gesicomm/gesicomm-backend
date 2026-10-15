'use strict';

const TABLA = 'meta_campana_leads';

const INDICES = [
  { name: 'meta_campana_leads_unico', fields: ['meta_campana_interna_id', 'envio_id', 'producto_id'], unique: true },
  { name: 'meta_campana_leads_envio', fields: ['envio_id'] },
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const tablas = await queryInterface.showAllTables({ transaction });
      if (!tablas.includes(TABLA)) {
        await queryInterface.createTable(TABLA, {
          id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
          meta_campana_interna_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'meta_campanas_internas', key: 'id' },
            onDelete: 'CASCADE',
          },
          envio_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'envios', key: 'id' },
            onDelete: 'CASCADE',
          },
          producto_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: { model: 'productos', key: 'id' },
            onDelete: 'CASCADE',
          },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        }, { transaction });
      }

      const existentes = await queryInterface.showIndex(TABLA, { transaction });
      for (const indice of INDICES) {
        if (!existentes.some((i) => i.name === indice.name)) {
          await queryInterface.addIndex(TABLA, indice.fields, {
            name: indice.name,
            unique: !!indice.unique,
            transaction,
          });
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
