const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AuthEvent = sequelize.define('AuthEvent', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  tipo: {
    type: DataTypes.STRING(60),
    allowNull: false,
  },
  resultado: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'ok',
  },
  ip: {
    type: DataTypes.STRING(64),
    allowNull: true,
  },
  user_agent: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  session_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
}, {
  tableName: 'auth_events',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['usuario_id'] },
    { fields: ['tipo'] },
    { fields: ['created_at'] },
    { fields: ['session_id'] },
  ],
});

module.exports = AuthEvent;
