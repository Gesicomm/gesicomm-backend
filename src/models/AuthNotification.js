const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AuthNotification = sequelize.define('AuthNotification', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  tipo: {
    type: DataTypes.STRING(60),
    allowNull: false,
  },
  titulo: {
    type: DataTypes.STRING(120),
    allowNull: false,
  },
  mensaje: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  auth_event_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  leida: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
}, {
  tableName: 'auth_notifications',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['leida'] },
    { fields: ['created_at'] },
    { fields: ['tipo'] },
  ],
});

module.exports = AuthNotification;
