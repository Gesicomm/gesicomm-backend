const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Pregunta frecuente de una Landing pública. Mismo criterio que Testimonio:
 * propia de cada landing, se sincroniza en bloque (ver
 * LandingService.sincronizarFaq), sin columna "activo".
 */
const Faq = sequelize.define('Faq', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  landing_id: {
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
  tableName: 'faqs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['landing_id'] },
  ],
});

module.exports = Faq;
