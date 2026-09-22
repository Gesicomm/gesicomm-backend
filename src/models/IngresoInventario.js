'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * IngresoInventario (Inbound)
 * 
 * Representa el movimiento de envío de stock físico desde el comercio
 * hacia la red de fulfillment de Gesicomm.
 */
const IngresoInventario = sequelize.define('IngresoInventario', {
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Comercio que envía el inventario.',
  },
  centro_gesicomm_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Depósito destino (alcance=GESICOMM).',
  },
  estado: {
    type: DataTypes.STRING(30),
    defaultValue: 'BORRADOR',
    allowNull: false,
    validate: { 
      isIn: [['BORRADOR', 'PENDIENTE_ENVIO', 'EN_TRANSITO', 'RECIBIDO', 'EN_VALIDACION', 'CON_DIFERENCIAS', 'DISPONIBLE']] 
    },
    comment: 'Estado de la operación de ingreso.',
  },
  fecha_envio: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  fecha_recepcion: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  transportista: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  numero_seguimiento: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  observacion: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'ingresos_inventario',
  timestamps: true,
});

module.exports = IngresoInventario;
