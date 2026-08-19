const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Pregunta frecuente propia de un Producto ("Todo lo que necesitas saber"),
 * mostrada en su página pública de detalle. Distinta del Faq de Landing
 * (landing_id): esta vive en el catálogo, así que la misma pregunta aparece
 * en cualquier landing donde se venda el producto. Mismo criterio de
 * sincronización que Faq/LandingBeneficio: destroy-all + bulkCreate, sin
 * columna "activo".
 */
const ProductoFaq = sequelize.define('ProductoFaq', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  pregunta: {
    type: DataTypes.STRING(300),
    allowNull: false,
  },
  respuesta: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'producto_faqs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['producto_id'] },
  ],
});

module.exports = ProductoFaq;
