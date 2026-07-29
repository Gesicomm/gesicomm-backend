const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Modelo de Combo de Productos.
 *
 * Notas importantes:
 * - producto_id: Producto PRINCIPAL del combo. No aparece como item.
 * - estado: Ciclo de vida BORRADOR → ACTIVO → INACTIVO.
 * - precio_total: Precio comercial publicado. Es editable por el admin.
 *   El motor puede sugerir precios pero el admin decide el valor final.
 * - snapshot_*: Se guardan al momento de crear/actualizar el combo.
 *   Preservan los valores económicos del momento de publicación,
 *   evitando que cambios futuros en el catálogo alteren el análisis histórico.
 * - activo: Mantenido temporalmente por compatibilidad. Se sincroniza con
 *   estado === 'ACTIVO'. Pendiente de eliminación en segunda iteración.
 */
const ProductoCombo = sequelize.define('ProductoCombo', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Aislamiento de tenant',
  },
  // FK al producto principal del combo.
  // Los upsells viven en ProductoComboItem.
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Producto principal del combo',
  },
  nombre: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  descripcion: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  // Precio comercial publicado. Editable por el admin.
  // El motor calcula sugerencias, pero este valor es la decisión final.
  precio_total: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0 },
  },
  // Ciclo de vida del combo.
  estado: {
    type: DataTypes.ENUM('BORRADOR', 'ACTIVO', 'INACTIVO'),
    allowNull: false,
    defaultValue: 'BORRADOR',
    comment: 'BORRADOR = en configuración. ACTIVO = publicado. INACTIVO = desactivado.',
  },
  fecha_inicio: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Inicio de vigencia del combo activo.',
  },
  fecha_fin: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Fin de vigencia del combo activo.',
  },
  // ─── Snapshot económico ───────────────────────────────────────────────────
  // Se guarda al crear o actualizar el combo. Preserva los inputs económicos
  // del catálogo vigentes en ese momento para trazabilidad histórica.
  snapshot_cpa_porcentaje: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    comment: 'CPA % vigente al momento de guardar el combo.',
  },
  snapshot_costo_envio: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'Costo de envío vigente al momento de guardar.',
  },
  snapshot_costo_confirmacion: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
  },
  snapshot_costo_empaque: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
  },
  snapshot_precio_original: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'Suma de precios originales (sin descuento) al momento de guardar.',
  },
  snapshot_precio_final: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'Precio final del combo al momento de guardar.',
  },
  snapshot_costo_total: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'Costo total del combo al momento de guardar.',
  },
  snapshot_utilidad: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
  },
  snapshot_margen: {
    type: DataTypes.DECIMAL(8, 4),
    allowNull: true,
    comment: 'Margen como fracción decimal (ej: 0.3 = 30%).',
  },
  // ─── Compatibilidad — será eliminado en segunda iteración ─────────────────
  // @deprecated Usar estado === 'ACTIVO' en su lugar.
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: '@deprecated. Sincronizado con estado === ACTIVO. Pendiente de eliminación.',
  },
}, {
  tableName: 'producto_combos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['inquilino_id'] },
    { fields: ['producto_id'] },
    { fields: ['estado'] },
    { unique: true, fields: ['producto_id', 'nombre'] },
  ],
});

module.exports = ProductoCombo;
