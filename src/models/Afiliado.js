const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Afiliado = sequelize.define('Afiliado', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  nombre: { type: DataTypes.STRING(150), allowNull: false },
  email: { type: DataTypes.STRING(255), allowNull: true },
  codigo: { type: DataTypes.STRING(80), allowNull: false, unique: true },
  comision_pct: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 40 },
  estado: { type: DataTypes.ENUM('activo', 'pausado'), allowNull: false, defaultValue: 'activo' },
  notas: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'afiliados',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Afiliado;
