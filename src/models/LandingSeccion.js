const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Bloque visual editable de una landing. Permite que la tienda publica se
 * arme como un constructor tipo Shopify: secciones activas, ordenables y con
 * configuracion/contenido propio sin seguir agregando columnas a landings.
 */
const LandingSeccion = sequelize.define('LandingSeccion', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  landing_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  stable_id: {
    type: DataTypes.STRING(40),
    allowNull: true,
  },
  tipo: {
    type: DataTypes.STRING(40),
    allowNull: false,
  },
  page_type: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'landing',
  },
  template_id: {
    type: DataTypes.STRING(60),
    allowNull: true,
  },
  nombre_interno: {
    type: DataTypes.STRING(120),
    allowNull: true,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  content_json: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {},
  },
  settings_json: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {},
  },
  responsive_json: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
  },
  visibility_json: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: { desktop: true, tablet: true, mobile: true },
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'published',
  },
  schema_version: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
}, {
  tableName: 'landing_secciones',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['landing_id'] },
    { fields: ['landing_id', 'orden'] },
  ],
});

module.exports = LandingSeccion;
