const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Qué couriers pueden despachar desde qué depósito (N:M).
 *
 * El costo no vive acá: pertenece al courier y su cobertura
 * (`delivery_zona_tarifas`). Esta tabla sólo dice con quién se puede
 * despachar desde un depósito dado.
 */
const DepositoCourier = sequelize.define('DepositoCourier', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  deposito_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  courier_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  prioridad: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Orden de preferencia al resolver el fulfillment. Menor = se evalúa antes.',
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'deposito_courier',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['deposito_id', 'courier_id'] },
    { fields: ['courier_id'] },
  ],
});

module.exports = DepositoCourier;
