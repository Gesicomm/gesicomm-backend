'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
module.exports = sequelize.define('SpeedboxTienda', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  usuario_id: { type: DataTypes.INTEGER, allowNull: false },
  environment: { type: DataTypes.STRING(20), allowNull: false },
  tienda_id: { type: DataTypes.STRING(100), allowNull: true },
  courier_id: { type: DataTypes.INTEGER, allowNull: true },
  activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  enabled_at: { type: DataTypes.DATE, allowNull: true },
  since_at: { type: DataTypes.STRING(50), allowNull: true },
  spec_verified_at: { type: DataTypes.DATE, allowNull: true },
  updates_verified_at: { type: DataTypes.DATE, allowNull: true },
  webhook_verified_at: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'speedbox_tiendas', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at',
  indexes: [{ unique: true, fields: ['usuario_id', 'environment'] }, { unique: true, fields: ['environment', 'tienda_id'] }] });
