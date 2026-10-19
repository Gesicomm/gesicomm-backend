'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

module.exports = sequelize.define('RahaDestino', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  nombre: { type: DataTypes.STRING(150), allowNull: false },
  ciudad: { type: DataTypes.STRING(100), allowNull: false },
  direccion: { type: DataTypes.STRING(255), allowNull: false },
  persona_contacto: { type: DataTypes.STRING(150), allowNull: false, defaultValue: '' },
  telefono_contacto: { type: DataTypes.STRING(50), allowNull: false, defaultValue: '' },
  activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  creado_por: { type: DataTypes.INTEGER, allowNull: false },
}, { tableName: 'raha_destinos', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });
