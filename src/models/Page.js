const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Page = sequelize.define('Page', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  tienda_id: { type: DataTypes.INTEGER, allowNull: false },
  page_type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'landing' },
  slug: { type: DataTypes.STRING, allowNull: false },
  nombre: { type: DataTypes.STRING, allowNull: false },
  estado: { type: DataTypes.STRING, allowNull: false, defaultValue: 'draft' },
  published_version_id: { type: DataTypes.INTEGER, allowNull: true },
  current_draft_version_id: { type: DataTypes.INTEGER, allowNull: true }
}, {
  tableName: 'pages',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = Page;
