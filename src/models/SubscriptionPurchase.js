const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SubscriptionPurchase = sequelize.define('SubscriptionPurchase', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  checkout_intent_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  suscripcion_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plan_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  plan_codigo: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  telefono: {
    type: DataTypes.STRING(40),
    allowNull: true,
  },
  documento: {
    type: DataTypes.STRING(30),
    allowNull: true,
  },
  affiliate_ref: {
    type: DataTypes.STRING(80),
    allowNull: true,
  },
  affiliate_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  monto: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  moneda: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'USD',
  },
  estado: {
    type: DataTypes.ENUM('created', 'payment_started', 'paid', 'failed', 'cancelled'),
    allowNull: false,
    defaultValue: 'created',
  },
  payment_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  paid_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
  },
}, {
  tableName: 'subscription_purchases',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['checkout_intent_id'] },
    { fields: ['suscripcion_id'] },
    { fields: ['payment_id'] },
    { fields: ['usuario_id'] },
    { fields: ['affiliate_id'] },
    { fields: ['estado'] },
  ],
});

module.exports = SubscriptionPurchase;
