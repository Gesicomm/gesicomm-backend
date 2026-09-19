const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Deposito = sequelize.define('Deposito', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  departamento: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  ciudad: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  direccion: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  referencia: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  persona_contacto: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  telefono_contacto: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  google_maps_url: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
  },
}, {
  tableName: 'depositos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Deposito;
