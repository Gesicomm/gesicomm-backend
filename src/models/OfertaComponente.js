const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Receta de stock de una Oferta: qué producto físico y cuántas unidades
 * consume cada unidad vendida de la oferta.
 *
 * Ej. "Earplugs x3" = 1 fila {producto_id: earplugs, cantidad: 3}.
 * Ej. "Combo Sueño" = 3 filas (earplugs×1, antifaz×1, melatonina×1).
 *
 * Un componente siempre apunta a un Producto, nunca a otra Oferta — mantiene
 * el modelo simple y sin riesgo de ciclos.
 */
const OfertaComponente = sequelize.define('OfertaComponente', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  oferta_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  cantidad: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    validate: { min: 1 },
    comment: 'Unidades de stock del producto que consume cada unidad vendida de la oferta.',
  },
  descuento_porcentaje: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0, max: 100 },
    comment: 'Solo tiene sentido en ofertas tipo_contenido=combo, sobre componentes que NO son el producto ancla (el equivalente a los "upsells" del motor de ProductoCombo — ver utils/comboPricing.js). Alimenta el análisis de sensibilidad/margen del combo, no afecta el precio real cobrado (Oferta.precio sigue siendo el único precio de venta).',
  },
}, {
  tableName: 'oferta_componentes',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['oferta_id'] },
    { fields: ['producto_id'] },
    { unique: true, fields: ['oferta_id', 'producto_id'] },
  ],
});

module.exports = OfertaComponente;
