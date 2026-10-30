const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Proveedor asociado a costos/gastos (ANDE, Google, Personal, etc.).
 * Escopado por usuario_id, igual que MetodoPago: es dato operativo del
 * dueño de la tienda, no catálogo compartido a nivel inquilino.
 */
const Proveedor = sequelize.define('Proveedor', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
  },
  precio_dolar: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'Precio del dolar específico para este proveedor',
  },
  logo_url: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Logo chico del proveedor. Se muestra sobre la tarjeta del producto en Mi catálogo para reconocer de un vistazo de qué proveedor viene. URL pública (no se re-hostea).',
  },
}, {
  tableName: 'proveedores',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Proveedor;
