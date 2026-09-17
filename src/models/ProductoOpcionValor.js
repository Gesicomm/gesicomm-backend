const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Valor posible de una ProductoOpcion (ej: "Negro", "16 GB").
 * Se vincula a variantes concretas vía ProductoVarianteValor.
 */
const ProductoOpcionValor = sequelize.define('ProductoOpcionValor', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  opcion_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  valor: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Valor libre del eje de variación, ej: "Negro", "16 GB".',
  },
  orden: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
  },
}, {
  tableName: 'producto_opcion_valores',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['opcion_id'] },
    { unique: true, fields: ['opcion_id', 'valor'] },
  ],
});

module.exports = ProductoOpcionValor;
