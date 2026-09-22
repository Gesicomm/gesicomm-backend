'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * IngresoInventarioItem
 * 
 * Detalles de los productos/variantes y cantidades dentro de un IngresoInventario.
 */
const IngresoInventarioItem = sequelize.define('IngresoInventarioItem', {
  ingreso_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  variante_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  cantidad_declarada: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1 },
  },
  cantidad_recibida: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  cantidad_aceptada: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  observacion_recepcion: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
}, {
  tableName: 'ingreso_inventario_items',
  timestamps: false,
});

module.exports = IngresoInventarioItem;
