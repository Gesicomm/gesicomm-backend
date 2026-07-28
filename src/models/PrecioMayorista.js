const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Precios escalonados por volumen o canal mayorista.
 * Ej: para 10+ unidades el precio por unidad es $X.
 */
const PrecioMayorista = sequelize.define('PrecioMayorista', {
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
  cantidad_minima: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Cantidad mínima de unidades para activar este precio.',
  },
  precio_unitario: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
}, {
  tableName: 'precios_mayoristas',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['producto_id'] },
  ],
});

module.exports = PrecioMayorista;
