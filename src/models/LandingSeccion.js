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
  tipo: {
    type: DataTypes.ENUM(
      'header',
      'announcement_bar',
      'hero',
      'beneficios',
      'categorias',
      'destacados',
      'productos',
      'banner',
      'texto',
      'como_funciona',
      'faq',
      'testimonios',
      'redes_sociales',
      'footer'
    ),
    allowNull: false,
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
  config_json: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
  },
  contenido_json: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
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
