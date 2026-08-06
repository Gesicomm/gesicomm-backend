const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Testimonio de cliente mostrado en una Landing pública. Propio de CADA
 * landing (no compartido entre las landings de una misma tienda) — mismo
 * criterio que el banner: contenido curado para esa página puntual.
 *
 * Se guarda/reemplaza en bloque junto con el resto de la landing (ver
 * LandingService.sincronizarTestimonios, mismo patrón que LandingItem), así
 * que no tiene columna "activo": sacar un testimonio de la lista y guardar
 * lo borra, no lo oculta.
 */
const Testimonio = sequelize.define('Testimonio', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  landing_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  foto: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Ruta relativa servida por /uploads, misma convención que ProductoImagen.url.',
  },
  calificacion: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 5,
    comment: '1 a 5, validado en el service.',
  },
  comentario: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'testimonios',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['landing_id'] },
  ],
});

module.exports = Testimonio;
