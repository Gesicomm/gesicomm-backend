'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TiendaFont = sequelize.define('TiendaFont', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  tienda_id: { type: DataTypes.INTEGER, allowNull: false },
  nombre: { type: DataTypes.STRING(120), allowNull: false },
  family: { type: DataTypes.STRING(160), allowNull: false },
  url: { type: DataTypes.STRING(700), allowNull: false },
  storage_key: { type: DataTypes.STRING(700), allowNull: false },
  mime_type: { type: DataTypes.STRING(100), allowNull: false },
  extension: { type: DataTypes.STRING(10), allowNull: false },
  size: { type: DataTypes.INTEGER, allowNull: false },
  weights: { type: DataTypes.JSON, allowNull: false, defaultValue: [400] },
  style: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'normal' },
  metadata: { type: DataTypes.JSON, allowNull: true },
}, {
  tableName: 'tienda_fonts',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['tienda_id'] },
    { fields: ['tienda_id', 'family'] },
  ],
});

module.exports = TiendaFont;
