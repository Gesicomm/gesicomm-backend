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
    // Sin unique: true — un tenant puede tener múltiples tiendas conectadas
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: true, // Para asegurar retrocompatibilidad inmediata, luego será false
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: true, // Nombre visible de la tienda (ej: "BM - Ecom"). Se toma de business_name al crear.
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
