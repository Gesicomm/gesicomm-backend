const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Mensaje enviado desde el formulario público de /contact.
 *
 * Se persiste en vez de solo mandarse por email porque las consultas de
 * privacidad y legales tienen que ser auditables: hay que poder demostrar
 * cuándo entró una consulta de un titular de datos y cuándo se respondió.
 *
 * `area` determina a qué casilla se deriva (privacy@ / legal@ / support@) y
 * es también lo que separa las consultas con relevancia normativa (privacidad,
 * legal) de las comerciales.
 */
const MensajeContacto = sequelize.define('MensajeContacto', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  area: {
    type: DataTypes.ENUM('soporte', 'privacidad', 'legal', 'comercial', 'seguridad'),
    allowNull: false,
    defaultValue: 'soporte',
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  empresa: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  asunto: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  mensaje: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  estado: {
    type: DataTypes.ENUM('nuevo', 'leido', 'respondido', 'descartado'),
    allowNull: false,
    defaultValue: 'nuevo',
  },
  ip_solicitante: {
    type: DataTypes.STRING(45),
    allowNull: true,
  },
  user_agent: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
}, {
  tableName: 'mensajes_contacto',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['estado'] },
    { fields: ['area'] },
    { fields: ['created_at'] },
  ],
});

module.exports = MensajeContacto;
