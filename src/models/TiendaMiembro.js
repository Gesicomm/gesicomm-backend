const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

module.exports = sequelize.define('TiendaMiembro', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  tienda_id: { type: DataTypes.INTEGER, allowNull: false },
  usuario_id: { type: DataTypes.INTEGER, allowNull: false },
  estado: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pendiente' },
  permisos: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  token_hash: DataTypes.STRING(64),
  token_expira: DataTypes.DATE,
  invitado_por: { type: DataTypes.INTEGER, allowNull: false },
}, { tableName: 'tienda_miembros', timestamps: true });
