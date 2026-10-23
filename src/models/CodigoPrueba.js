const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

module.exports = sequelize.define('CodigoPrueba', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  codigo: { type: DataTypes.STRING(40), allowNull: false, unique: true },
  dias: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 365 } },
  plan_id: { type: DataTypes.INTEGER, allowNull: false },
  creado_por: { type: DataTypes.INTEGER, allowNull: false },
  email: { type: DataTypes.STRING(255), allowNull: true },
  activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  vence_en: { type: DataTypes.DATE, allowNull: true },
  usado_por: { type: DataTypes.INTEGER, allowNull: true },
  usado_en: { type: DataTypes.DATE, allowNull: true },
  suscripcion_id: { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: 'codigos_prueba', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });
