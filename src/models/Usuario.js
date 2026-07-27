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
}, {
  tableName: 'usuarios',
  timestamps: true,
});

module.exports = Usuario;
