const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Qué proveedores logísticos operan desde qué centro de fulfillment (N:M).
 *
 * Responde "quién trabaja desde acá", no "cuánto cobra". El costo vive en
 * `delivery_zona_tarifas`, que tiene su propio `centro_id` porque un mismo
 * proveedor puede cobrar distinto según desde qué centro sale.
 */
const CentroProveedorLogistico = sequelize.define('CentroProveedorLogistico', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  centro_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Depósito con alcance GESICOMM. La restricción la valida el servicio: no hay FK que pueda expresarla.',
  },
  proveedor_logistico_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  prioridad: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Orden de preferencia al resolver la entrega. Menor = se evalúa antes.',
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'centro_proveedor_logistico',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['centro_id', 'proveedor_logistico_id'] },
    { fields: ['centro_id'] },
  ],
});

module.exports = CentroProveedorLogistico;
