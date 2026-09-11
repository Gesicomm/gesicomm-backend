const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const NotificationEvent = sequelize.define('NotificationEvent', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  event_key: {
    type: DataTypes.STRING(160),
    allowNull: false,
    unique: true,
  },
  tipo: {
    type: DataTypes.STRING(80),
    allowNull: false,
  },
  canal: {
    type: DataTypes.STRING(40),
    allowNull: false,
    defaultValue: 'email',
  },
  provider: {
    type: DataTypes.STRING(40),
    allowNull: true,
  },
  estado: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'pending',
  },
  destinatario: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  asunto: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  envio_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  attempts: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  last_error: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  sent_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
}, {
  tableName: 'notification_events',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = NotificationEvent;
