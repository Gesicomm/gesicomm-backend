const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Opción de un producto (ej: "Color", "RAM"). Define un eje de variación;
 * sus valores viven en ProductoOpcionValor. La combinatoria de valores de
 * todas las opciones de un producto genera sus variantes (ProductoVariante),
 * vinculadas vía ProductoVarianteValor.
 */
const ProductoOpcion = sequelize.define('ProductoOpcion', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Denormalizado para aislamiento de tenant sin depender de JOINs.',
  },
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  nombre: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Nombre libre del eje de variación, ej: "Color", "RAM".',
  },
  orden: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
  },
}, {
  tableName: 'producto_opciones',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['producto_id'] },
    { unique: true, fields: ['producto_id', 'nombre'] },
  ],
});

module.exports = ProductoOpcion;
