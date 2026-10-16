'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Sin tokens: Meta descarga una instantánea comercial pública por hostname.
module.exports = sequelize.define('MetaFeed', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  tienda_id: { type: DataTypes.INTEGER, allowNull: false },
  landing_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  revision_generada: { type: DataTypes.INTEGER, allowNull: true },
  archivo: { type: DataTypes.STRING(255), allowNull: true },
  generado_at: { type: DataTypes.DATE, allowNull: true },
  descargado_at: { type: DataTypes.DATE, allowNull: true },
  cantidad: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  omitidos: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  error: { type: DataTypes.STRING(500), allowNull: true },
}, { tableName: 'meta_feeds', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });
