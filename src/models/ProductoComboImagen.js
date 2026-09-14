const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Galería propia de un combo.
 *
 * No reutiliza ProductoImagen porque un combo es una entidad vendible propia:
 * puede necesitar fotos del pack completo aunque sus productos individuales
 * tengan otras imágenes.
 */
const ProductoComboImagen = sequelize.define('ProductoComboImagen', {
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
  combo_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  url: {
    type: DataTypes.STRING(500),
    allowNull: false,
  },
  storage_key: {
    type: DataTypes.STRING(700),
    allowNull: true,
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
  tableName: 'producto_combo_imagenes',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['combo_id'] },
    { fields: ['inquilino_id'] },
    { fields: ['storage_key'] },
  ],
});

module.exports = ProductoComboImagen;
