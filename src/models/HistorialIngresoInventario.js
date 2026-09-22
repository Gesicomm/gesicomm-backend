'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * HistorialIngresoInventario
 * 
 * Auditoría de transiciones y eventos del inbound.
 */
const HistorialIngresoInventario = sequelize.define('HistorialIngresoInventario', {
  ingreso_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Admin o comercio que realizó la acción',
  },
  estado: {
    type: DataTypes.STRING(30),
    allowNull: false,
  },
  comentario: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
}, {
  tableName: 'historial_ingresos_inventario',
  timestamps: true,
  updatedAt: false, // Solo queremos createdAt para auditoría
});

module.exports = HistorialIngresoInventario;
