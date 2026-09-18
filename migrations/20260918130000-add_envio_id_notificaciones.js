'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('notificaciones', 'envio_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'envios', key: 'id' },
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('notificaciones', ['envio_id'], { name: 'idx_notificaciones_envio_id' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('notificaciones', 'idx_notificaciones_envio_id');
    await queryInterface.removeColumn('notificaciones', 'envio_id');
  },
};
