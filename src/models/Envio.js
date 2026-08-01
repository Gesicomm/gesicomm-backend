const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Envio = sequelize.define('Envio', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  courier_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  fecha: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  hora: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  confirmador: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  cliente: {
    type: DataTypes.STRING(255),
    allowNull: false,
    defaultValue: 'Cliente',
  },
  nombre_cliente: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  apellido_cliente: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  telefono: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  departamento: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  ciudad: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  direccion: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  referencia: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  link_maps: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  monto: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  costo_envio: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  metodo_pago: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'Efectivo',
  },
  observaciones: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  estado: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'Pendiente',
  },
  dispatchedAt: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  fecha_rendicion: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
}, {
  tableName: 'envios',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Envio;
