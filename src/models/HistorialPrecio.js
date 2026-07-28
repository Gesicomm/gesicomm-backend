const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Historial de cambios de precio de un producto.
 *
 * Se genera automáticamente (hook en el controller de Producto) cuando
 * cambia precio_base O descuento_porcentaje — no cuando el admin lo recuerda.
 *
 * Registra el precio_efectivo calculado al momento del cambio para que el
 * historial sea legible sin necesidad de recalcular nada a futuro.
 */
const HistorialPrecio = sequelize.define('HistorialPrecio', {
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
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'FK a Usuario. Quién realizó el cambio.',
  },
  precio_base_anterior: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  precio_base_nuevo: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  descuento_anterior: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0,
  },
  descuento_nuevo: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0,
  },
  precio_efectivo_anterior: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: 'Precio final calculado antes del cambio. Incluye descuento si estaba vigente.',
  },
  precio_efectivo_nuevo: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: 'Precio final calculado después del cambio.',
  },
  fecha_cambio: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'historial_precios',
  timestamps: false,
  indexes: [
    { fields: ['producto_id'] },
    { fields: ['inquilino_id'] },
    { fields: ['fecha_cambio'] },
  ],
});

module.exports = HistorialPrecio;
