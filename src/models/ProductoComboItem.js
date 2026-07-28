const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Modelo de Item de Combo (Upsells).
 *
 * Representa exclusivamente los productos COMPLEMENTARIOS (upsells) del combo.
 * El producto principal vive en ProductoCombo.producto_id y NO aparece aquí.
 *
 * - descuento_porcentaje: Descuento individual configurado por el admin para este upsell.
 * - orden: Posición de visualización del upsell en el combo.
 * - snapshot_*: Se guardan al momento de crear/actualizar el combo.
 *   Preservan el estado del catálogo en ese momento para trazabilidad histórica.
 */
const ProductoComboItem = sequelize.define('ProductoComboItem', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  combo_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  producto_incluido_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Producto upsell. Nunca es el mismo que ProductoCombo.producto_id.',
  },
  cantidad: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    validate: { min: 1 },
  },
  // Descuento configurado por el admin para este upsell específico.
  // El admin puede asignar distintos descuentos a cada upsell del combo.
  descuento_porcentaje: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0, max: 100 },
    comment: 'Descuento individual del upsell. 0 = sin descuento. 100 = gratuito.',
  },
  // Posición de visualización en la UI del combo.
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  // ─── Snapshot económico ───────────────────────────────────────────────────
  // Se guarda al crear o actualizar el combo.
  // Permite reconstruir el análisis histórico sin depender del catálogo actual.
  snapshot_costo: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'precio_costo del producto al momento de guardar el combo.',
  },
  snapshot_precio_base: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'precio_base del producto al momento de guardar el combo.',
  },
  snapshot_precio_final: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'Precio efectivo del upsell (precio_base * (1 - descuento)) al guardar.',
  },
}, {
  tableName: 'producto_combo_items',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['combo_id'] },
    { fields: ['producto_incluido_id'] },
    { unique: true, fields: ['combo_id', 'producto_incluido_id'] },
  ],
});

module.exports = ProductoComboItem;
