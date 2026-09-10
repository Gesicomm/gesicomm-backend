const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AfiliadoClick = sequelize.define('AfiliadoClick', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  afiliado_id: { type: DataTypes.INTEGER, allowNull: false },
  codigo: { type: DataTypes.STRING(80), allowNull: false },
  landing_url: { type: DataTypes.TEXT, allowNull: true },
  ip_hash: { type: DataTypes.STRING(64), allowNull: true },
  user_agent: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'afiliado_clicks',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['afiliado_id'] },
    { fields: ['codigo'] },
  ],
});

module.exports = AfiliadoClick;
