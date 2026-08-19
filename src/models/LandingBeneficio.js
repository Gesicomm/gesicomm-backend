const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Tarjeta de la sección "Beneficios" de una landing rígida (ver
 * landingSimple.service.js) — título, texto e ícono elegido por el
 * comercio (ver catálogo en el frontend: templates/iconosBeneficios.js).
 * "icono" guarda solo la clave (ej. "shield"), nunca el JSX — si viene
 * null o una clave no reconocida, el frontend cae a un ícono genérico.
 * Mismo criterio que Faq: propia de cada landing, se sincroniza en bloque
 * (destroy-all + bulkCreate), sin columna "activo".
 */
const LandingBeneficio = sequelize.define('LandingBeneficio', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  landing_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  titulo: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  texto: {
    type: DataTypes.STRING(300),
    allowNull: false,
  },
  icono: {
    type: DataTypes.STRING(30),
    allowNull: true,
  },
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'landing_beneficios',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['landing_id'] },
  ],
});

module.exports = LandingBeneficio;
