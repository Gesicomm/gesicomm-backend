const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

module.exports = sequelize.define('TutorialSistema', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  clave: { type: DataTypes.STRING(80), allowNull: false, unique: true },
  url: { type: DataTypes.STRING(500), allowNull: false },
  actualizado_por: { type: DataTypes.INTEGER, allowNull: false },
  updated_at: { type: DataTypes.DATE, allowNull: false },
}, { tableName: 'tutoriales_sistema', timestamps: false });
