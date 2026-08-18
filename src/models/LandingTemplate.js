const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const LandingTemplate = sequelize.define('LandingTemplate', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  slug: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  funnel_type: {
    type: DataTypes.ENUM('direct_sale', 'educational', 'lifestyle'),
    allowNull: false,
    defaultValue: 'direct_sale',
  },
  version: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  status: {
    type: DataTypes.ENUM('draft', 'published', 'archived'),
    allowNull: false,
    defaultValue: 'draft',
  },
  preview_image: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  schema: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: [], // Array de definiciones de secciones
  },
  design_tokens: {
    type: DataTypes.JSON,
    allowNull: true, // Colores base, tipografía, etc.
  }
}, {
  tableName: 'landing_templates',
  timestamps: true,
});

module.exports = LandingTemplate;
