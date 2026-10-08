const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PaymentLogo = sequelize.define('PaymentLogo', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  clave: {
    type: DataTypes.STRING(80),
    allowNull: false,
    unique: true,
  },
  grupo: {
    type: DataTypes.STRING(60),
    allowNull: false,
  },
  nombre: {
    type: DataTypes.STRING(120),
    allowNull: false,
  },
  logo_url: {
    type: DataTypes.STRING(700),
    allowNull: false,
  },
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'payment_logos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = PaymentLogo;
