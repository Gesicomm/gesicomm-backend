const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Relaciones entre productos ("También te puede interesar", combos).
 * La relación es direccional: producto_id → producto_relacionado_id.
 */
const ProductoRelacionado = sequelize.define('ProductoRelacionado', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Denormalizado para aislamiento de tenant.',
  },
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  producto_relacionado_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'productos_relacionados',
  timestamps: false,
  indexes: [
    { fields: ['producto_id'] },
    { unique: true, fields: ['producto_id', 'producto_relacionado_id'] },
  ],
});

module.exports = ProductoRelacionado;
