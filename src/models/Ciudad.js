const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Ciudad = sequelize.define('Ciudad', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  departamento_id: { type: DataTypes.INTEGER, allowNull: false },
  nombre: { type: DataTypes.STRING(150), allowNull: false },
  nombre_normalizado: { type: DataTypes.STRING(150), allowNull: false },
  activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName: 'ciudades', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at',
});

module.exports = Ciudad;
