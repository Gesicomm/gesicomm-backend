'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
module.exports = sequelize.define('RahaDocumento', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  solicitud_id: { type: DataTypes.INTEGER, allowNull: false },
  tipo: { type: DataTypes.STRING(30), allowNull: false },
  nombre: { type: DataTypes.STRING(180), allowNull: false },
  storage_key: { type: DataTypes.STRING(200), allowNull: false },
  storage_backend: { type: DataTypes.STRING(20), allowNull: false },
  mime: { type: DataTypes.STRING(80), allowNull: false },
  size: { type: DataTypes.INTEGER, allowNull: false },
  sha256: { type: DataTypes.STRING(64), allowNull: false },
}, { tableName: 'raha_documentos', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at',
  indexes: [{ fields: ['solicitud_id'] }] });
