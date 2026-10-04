'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
module.exports = sequelize.define('SpeedboxPedido', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  envio_id: { type: DataTypes.INTEGER, allowNull: false },
  usuario_id: { type: DataTypes.INTEGER, allowNull: false },
  environment: { type: DataTypes.STRING(20), allowNull: false },
  external_order_id: { type: DataTypes.STRING(100), allowNull: false },
  order_id: { type: DataTypes.STRING(100), allowNull: true },
  estado: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'pendiente' },
  status: { type: DataTypes.STRING(50), allowNull: true },
  status_at: { type: DataTypes.DATE, allowNull: true },
  request_payload: { type: DataTypes.JSONB, allowNull: true },
  response_payload: { type: DataTypes.JSONB, allowNull: true },
  intentos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  error: { type: DataTypes.TEXT, allowNull: true },
  remote_http_status: { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: 'speedbox_pedidos', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at',
  indexes: [{ unique: true, fields: ['environment', 'envio_id'] }, { unique: true, fields: ['environment', 'order_id'] }] });
