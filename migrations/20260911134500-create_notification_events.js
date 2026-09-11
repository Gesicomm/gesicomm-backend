'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('notification_events', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      event_key: {
        type: Sequelize.STRING(160),
        allowNull: false,
        unique: true,
      },
      tipo: {
        type: Sequelize.STRING(80),
        allowNull: false,
      },
      canal: {
        type: Sequelize.STRING(40),
        allowNull: false,
        defaultValue: 'email',
      },
      provider: {
        type: Sequelize.STRING(40),
        allowNull: true,
      },
      estado: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: 'pending',
      },
      destinatario: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      asunto: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      envio_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'envios', key: 'id' },
        onDelete: 'SET NULL',
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'usuarios', key: 'id' },
        onDelete: 'SET NULL',
      },
      attempts: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      last_error: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      sent_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.addIndex('notification_events', ['tipo', 'estado'], { name: 'idx_notification_events_tipo_estado' });
    await queryInterface.addIndex('notification_events', ['envio_id'], { name: 'idx_notification_events_envio_id' });
    await queryInterface.addIndex('notification_events', ['created_at'], { name: 'idx_notification_events_created_at' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('notification_events');
  },
};
