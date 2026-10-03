'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
module.exports = sequelize.define('RahaSolicitud', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  usuario_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  tienda_id: { type: DataTypes.INTEGER, allowNull: false },
  inquilino_id: { type: DataTypes.INTEGER, allowNull: false },
  estado: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'borrador' },
  datos: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  historial: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  enviado_at: { type: DataTypes.DATE },
}, { tableName: 'raha_solicitudes', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at',
  indexes: [{ fields: ['inquilino_id', 'estado'] }] });
