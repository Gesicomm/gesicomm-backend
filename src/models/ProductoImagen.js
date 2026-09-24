const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Imágenes de un producto.
 * - variante_id es opcional: si se asigna, la imagen pertenece a esa variante específica.
 * - es_principal marca la imagen destacada del producto.
 * - orden define el orden de galería.
 * - Las imágenes nuevas se procesan con sharp y se almacenan en R2; url se
 *   conserva como contrato de API para consumidores existentes.
 */
const ProductoImagen = sequelize.define('ProductoImagen', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Denormalizado para aislamiento de tenant sin depender de JOINs.',
  },
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  variante_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Si no es null, la imagen pertenece a esta variante específica (ej: foto del color rojo).',
  },
  url: {
    type: DataTypes.STRING(500),
    allowNull: false,
  },
  storage_key: {
    type: DataTypes.STRING(700),
    allowNull: true,
    comment: 'Key del objeto en Cloudflare R2. Null para imágenes legacy en /uploads.',
  },
  original_url: {
    type: DataTypes.STRING(700),
    allowNull: true,
    comment: 'URL del archivo original subido por el usuario. La galería pública usa url/storage_key optimizada.',
  },
  original_storage_key: {
    type: DataTypes.STRING(700),
    allowNull: true,
    comment: 'Key R2 del original intacto.',
  },
  visual_modo: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'contain',
    comment: 'Modo de galería: contain = mostrar completa, cover = rellenar marco.',
  },
  focal_x: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 50,
  },
  focal_y: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 50,
  },
  optimizacion_json: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Metadata del recorte automático y dimensiones de la versión optimizada.',
  },
  mime_type: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  size: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  width: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  height: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  es_principal: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false,
  },
  orden: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
  },
}, {
  tableName: 'producto_imagenes',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['producto_id'] },
    { fields: ['variante_id'] },
    { fields: ['inquilino_id'] },
    { fields: ['storage_key'] },
  ],
});

module.exports = ProductoImagen;
