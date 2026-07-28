const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Variantes de un producto (ej: Talle M - Rojo, Talle L - Azul).
 * Cada variante tiene su propio stock y puede tener un precio diferencial.
 *
 * Regla de negocio:
 * - Si un producto tiene variantes, cantidad_disponible del padre
 *   se calcula sumando los stocks de sus variantes activas.
 * - El precio efectivo de la variante (precio_base + precio_diferencial con descuento)
 *   también debe respetar precio_minimo del producto padre.
 */
const ProductoVariante = sequelize.define('ProductoVariante', {
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
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: 'Descripción de la variante, ej: "Talle M - Rojo".',
  },
  sku_variante: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  stock: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
  },
  precio_diferencial: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    allowNull: false,
    comment: 'Se suma a precio_base del producto. Puede ser negativo.',
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
  },
}, {
  tableName: 'producto_variantes',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['producto_id'] },
    { fields: ['inquilino_id'] },
  ],
});

module.exports = ProductoVariante;
