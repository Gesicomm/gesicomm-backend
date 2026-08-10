const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/** Qué pedidos entraron en cada Liquidacion (join table). */
const LiquidacionEnvio = sequelize.define('LiquidacionEnvio', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  liquidacion_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  envio_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
}, {
  tableName: 'liquidacion_envios',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['liquidacion_id'] },
    { fields: ['envio_id'] },
    { unique: true, fields: ['liquidacion_id', 'envio_id'] },
  ],
});

module.exports = LiquidacionEnvio;
