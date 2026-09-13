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
  },
  affiliate_ref: {
    type: DataTypes.STRING(80),
    allowNull: true,
    comment: 'Código público del afiliado atribuido en el signup original. No se sobreescribe por clicks futuros.',
  },
  affiliate_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'ID interno del afiliado atribuido en el signup original. Lo fija el backend desde el checkout intent.',
  },
  email_verificado: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'true = el usuario confirmó su correo con el código OTP. Los usuarios creados antes de esta feature arrancan con true para no bloquear cuentas existentes.',
  },
  codigo_verificacion: {
    type: DataTypes.STRING(6),
    allowNull: true,
    comment: 'Código OTP de 6 dígitos en texto plano (nunca se almacena, solo se usa para comparar).',
  },
  codigo_verificacion_expira: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Timestamp de expiración del código OTP. El código es válido por 15 minutos.',
  },
  password_reset_token_hash: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: 'Hash SHA-256 del token de recuperación de contraseña. El token crudo solo viaja por email.',
  },
  password_reset_expira: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Timestamp de expiración del enlace de recuperación de contraseña.',
  },
}, {
  tableName: 'usuarios',
  timestamps: true,
});

module.exports = Usuario;
