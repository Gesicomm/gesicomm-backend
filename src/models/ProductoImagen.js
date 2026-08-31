const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Imágenes de un producto.
 * - variante_id es opcional: si se asigna, la imagen pertenece a esa variante específica.
 * - es_principal marca la imagen destacada del producto.
 * - orden define el orden de galería.
 * - Las imágenes se procesan con sharp antes de guardarse (max 1200px, JPEG 80%).
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
  ],
});

module.exports = ProductoImagen;
