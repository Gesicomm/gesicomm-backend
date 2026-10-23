'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.createTable('codigos_prueba', {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
        codigo: { type: Sequelize.STRING(40), allowNull: false, unique: true },
        dias: { type: Sequelize.INTEGER, allowNull: false },
        plan_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'planes', key: 'id' }, onDelete: 'RESTRICT' },
        creado_por: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'usuarios', key: 'id' }, onDelete: 'RESTRICT' },
        email: { type: Sequelize.STRING(255), allowNull: true },
        activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        vence_en: { type: Sequelize.DATE, allowNull: true },
        usado_por: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'usuarios', key: 'id' }, onDelete: 'SET NULL' },
        usado_en: { type: Sequelize.DATE, allowNull: true },
        suscripcion_id: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'suscripciones', key: 'id' }, onDelete: 'SET NULL' },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.sequelize.query('ALTER TABLE codigos_prueba ADD CONSTRAINT codigos_prueba_dias CHECK (dias BETWEEN 1 AND 365)', { transaction });
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('codigos_prueba'); },
};
