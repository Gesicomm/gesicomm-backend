const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const MetaIntegration = sequelize.define('MetaIntegration', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true // un tenant tiene una integración de Meta activa a la vez por ahora
  },
  access_token: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  business_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  business_name: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  waba_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  phone_number_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  estado: {
    type: DataTypes.ENUM('conectado', 'desconectado'),
    defaultValue: 'desconectado'
  }
}, {
  tableName: 'meta_integrations',
  timestamps: true,
});

module.exports = MetaIntegration;
