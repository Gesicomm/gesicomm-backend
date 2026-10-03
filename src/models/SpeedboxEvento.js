'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
module.exports = sequelize.define('SpeedboxEvento', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  environment: { type: DataTypes.STRING(20), allowNull: false },
  event_key: { type: DataTypes.STRING(180), allowNull: false },
  tipo: { type: DataTypes.STRING(100), allowNull: false },
  usuario_id: { type: DataTypes.INTEGER, allowNull: true },
  order_id: { type: DataTypes.STRING(100), allowNull: true },
  tienda_id: { type: DataTypes.STRING(100), allowNull: true },
  occurred_at: { type: DataTypes.DATE, allowNull: true },
  source: { type: DataTypes.STRING(20), allowNull: false },
  payload: { type: DataTypes.JSONB, allowNull: false },
  estado: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'pendiente' },
  detalle: { type: DataTypes.TEXT, allowNull: true },
  conciliacion: { type: DataTypes.JSONB, allowNull: true },
}, { tableName: 'speedbox_eventos', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at',
  indexes: [{ unique: true, fields: ['environment', 'event_key'] }, { fields: ['usuario_id', 'tipo'] }] });
