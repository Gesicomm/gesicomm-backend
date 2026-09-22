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
  // `usuario_id` responde "¿quién es el dueño?"; `alcance` responde "¿para
  // qué red logística existe?". Son preguntas distintas: hay administradores
  // que además operan su propio comercio, así que "pertenece a un admin" no
  // identifica infraestructura de Gesicomm.
  alcance: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'PROPIO',
    validate: { isIn: [['GESICOMM', 'PROPIO']] },
    comment: 'PROPIO = depósito privado del comercio. GESICOMM = centro de fulfillment de la red, designado por un administrador.',
  },
}, {
  tableName: 'depositos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Deposito;
