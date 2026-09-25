const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PageVersion = sequelize.define('PageVersion', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  page_id: { type: DataTypes.INTEGER, allowNull: false },
  revision: { type: DataTypes.INTEGER, allowNull: false },
  schema_json: { type: DataTypes.JSONB, allowNull: false },
  source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'AI_GENERATION' },
  prompt: { type: DataTypes.TEXT, allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
  parent_version_id: { type: DataTypes.INTEGER, allowNull: true }
}, {
  tableName: 'page_versions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false
});

module.exports = PageVersion;
