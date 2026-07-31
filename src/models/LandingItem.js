const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Item (producto o combo) incluido en una Landing, con la agrupación
 * propia que el usuario le puso para ESA landing (no depende de la
 * categoría/marca del catálogo del admin).
 */
const LandingItem = sequelize.define('LandingItem', {
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
    type: DataTypes.ENUM('producto', 'combo'),
    allowNull: false,
  },
  referencia_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'FK a Producto.id o ProductoCombo.id según "tipo".',
  },
  etiqueta: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Agrupación propia del usuario dentro de esta landing (ej: "Ofertas").',
  },
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'landing_items',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['landing_id', 'tipo', 'referencia_id'] },
    { fields: ['landing_id'] },
  ],
});

module.exports = LandingItem;
