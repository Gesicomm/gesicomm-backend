'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const [rows] = await queryInterface.sequelize.query("SELECT to_regclass('public.tutoriales_sistema') AS tabla");
    if (rows[0]?.tabla) return;
    await queryInterface.createTable('tutoriales_sistema', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      clave: { type: Sequelize.STRING(80), allowNull: false, unique: true },
      url: { type: Sequelize.STRING(500), allowNull: false },
      actualizado_por: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'usuarios', key: 'id' }, onDelete: 'RESTRICT' },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('tutoriales_sistema'); },
};
