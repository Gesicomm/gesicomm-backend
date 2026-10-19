const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

module.exports = sequelize.define('PartnerSolicitud', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  usuario_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  nombre: { type: DataTypes.STRING(150), allowNull: false },
  email: { type: DataTypes.STRING(255), allowNull: false },
  telefono: { type: DataTypes.STRING(50), allowNull: false },
  estado: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'pendiente' },
  terminos_version: { type: DataTypes.STRING(30), allowNull: false },
  terminos_aceptados_en: { type: DataTypes.DATE, allowNull: false },
}, {
  tableName: 'partner_solicitudes',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});
