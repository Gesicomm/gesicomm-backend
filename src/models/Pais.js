const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Pais = sequelize.define('Pais', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  codigo: { type: DataTypes.STRING(2), allowNull: false },
  nombre: { type: DataTypes.STRING(100), allowNull: false },
  activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName: 'paises', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at',
});

module.exports = Pais;
