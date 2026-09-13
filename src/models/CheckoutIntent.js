const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CheckoutIntent = sequelize.define('CheckoutIntent', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  token: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    allowNull: false,
    unique: true,
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
    allowNull: true,
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  telefono: {
    type: DataTypes.STRING(40),
    allowNull: true,
  },
  documento: {
    type: DataTypes.STRING(30),
    allowNull: true,
  },
  authenticated: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  estado: {
    type: DataTypes.ENUM('active', 'expired', 'completed', 'abandoned'),
    allowNull: false,
    defaultValue: 'active',
  },
  affiliate_ref: {
    type: DataTypes.STRING(80),
    allowNull: true,
    comment: 'Código público resuelto al crear el intent. Inmutable.',
  },
  affiliate_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'ID interno del afiliado activo resuelto por backend al crear el intent. Inmutable.',
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  abandoned_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
  },
}, {
  tableName: 'checkout_intents',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['token'], unique: true },
    { fields: ['email'] },
    { fields: ['usuario_id'] },
    { fields: ['estado'] },
    { fields: ['affiliate_id'] },
    { fields: ['expires_at'] },
  ],
});

module.exports = CheckoutIntent;
