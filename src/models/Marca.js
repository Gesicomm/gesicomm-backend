const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Modelo de Marca.
 * ABM propio para estandarizar el catálogo y evitar datos sucios
 * (ej: "Nike", "nike", "NIKE ").
 */
const Marca = sequelize.define('Marca', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  slug: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
  },
}, {
  tableName: 'marcas',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['slug', 'inquilino_id'] },
  ],
});

module.exports = Marca;
