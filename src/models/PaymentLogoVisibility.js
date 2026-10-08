const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PaymentLogoVisibility = sequelize.define('PaymentLogoVisibility', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  payment_logo_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  tienda_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  landing_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'payment_logo_visibilities',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = PaymentLogoVisibility;
