const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProveedorDns = sequelize.define('ProveedorDns', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  nombre: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  whois_match: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Subcadena a buscar en el resultado de WHOIS (ej: godaddy, namecheap)',
  },
  url_login: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'URL directa al panel de configuración DNS del proveedor',
  },
  instrucciones: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Texto o markdown con las indicaciones',
  },
  logo_url: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
}, {
  tableName: 'proveedores_dns',
  timestamps: true,
});

module.exports = ProveedorDns;
