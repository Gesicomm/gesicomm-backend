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
}, {
  tableName: 'proveedores',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Proveedor;
