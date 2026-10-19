'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

module.exports = sequelize.define('RahaEnvioStock', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  usuario_id: { type: DataTypes.INTEGER, allowNull: false },
  tienda_id: { type: DataTypes.INTEGER, allowNull: false },
  deposito_origen_id: { type: DataTypes.INTEGER, allowNull: false },
  destino_raha_id: { type: DataTypes.INTEGER, allowNull: false },
  solicitud_key: { type: DataTypes.UUID, allowNull: false },
  solicitud_hash: { type: DataTypes.STRING(64), allowNull: false },
  estado: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'solicitada' },
  items: { type: DataTypes.JSONB, allowNull: false },
  origen_snapshot: { type: DataTypes.JSONB, allowNull: false },
  destino_snapshot: { type: DataTypes.JSONB, allowNull: false },
  observacion: { type: DataTypes.STRING(2000), allowNull: false, defaultValue: '' },
  historial: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, { tableName: 'raha_envios_stock', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });
