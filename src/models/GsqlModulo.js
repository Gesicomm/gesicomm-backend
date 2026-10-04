const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const GsqlModulo = sequelize.define('GsqlModulo', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  modulo_key: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
  },
  contexto: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'ecommerce',
  },
  seccion: {
    type: DataTypes.STRING(80),
    allowNull: false,
  },
  etiqueta: {
    type: DataTypes.STRING(120),
    allowNull: false,
  },
  path: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  prefix: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
  icono: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'Circle',
  },
  menu_key: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  roles_permitidos: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: [],
  },
  requiere_plan: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  badge: {
    type: DataTypes.STRING(40),
    allowNull: true,
  },
  danger_badge_key: {
    type: DataTypes.STRING(80),
    allowNull: true,
  },
  visible: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
}, {
  tableName: 'gsql_modulos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = GsqlModulo;
