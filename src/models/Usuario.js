const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const Inquilino = require('./Inquilino');
const Rol = require('./Rol');

const Usuario = sequelize.define('Usuario', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: Inquilino,
      key: 'id',
    },
  },
  rol_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: Rol,
      key: 'id',
    },
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  correo_electronico: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true,
    },
  },
  contrasena_hash: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: 'false = usuario suspendido. Hoy solo se usa para ocultar sus landings públicas, no bloquea login.',
  },
  plan: {
    type: DataTypes.ENUM('free', 'pago'),
    allowNull: true,
    comment: 'Elegido en el onboarding, a nivel de cuenta (no por tienda) — hoy 1 tienda por usuario, pero el plan ya queda a nivel cuenta pensando en soportar varias más adelante. null hasta completar el onboarding. Sin cobro integrado — "pago" solo marca la intención.',
  },
}, {
  tableName: 'usuarios',
  timestamps: true,
});

module.exports = Usuario;
