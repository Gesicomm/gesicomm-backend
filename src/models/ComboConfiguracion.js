const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Configuración económica de combos por tenant (Inquilino).
 *
 * Se crea automáticamente con valores por defecto la primera vez que
 * un tenant accede al módulo de combos (findOrCreate en el servicio).
 * Siempre es visible y editable por el administrador.
 *
 * Los campos JSON permiten flexibilidad sin necesidad de alterar el schema:
 * - margenes_objetivo: Ej. [15, 30, 45] — para calcular precios sugeridos.
 * - escenarios_descuento: Ej. [0, 5, 10, 15, 20, 25, 30, 35] — para análisis de sensibilidad.
 *
 * margen_minimo actúa como UMBRAL DE ADVERTENCIA, no como regla de bloqueo.
 * El sistema advierte si el margen queda por debajo, pero no impide guardar el combo.
 */
const ComboConfiguracion = sequelize.define('ComboConfiguracion', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
    comment: 'Un registro por tenant.',
  },
  // ─── Costos y porcentajes ─────────────────────────────────────────────────
  cpa_porcentaje: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 20.00,
    comment: 'Costo por Adquisición como % del precio de venta. Default: 20%.',
  },
  costo_envio: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
    comment: 'Costo promedio de envío por combo.',
  },
  costo_confirmacion: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
    comment: 'Costo de confirmación por combo.',
  },
  costo_empaque: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
    comment: 'Costo de empaque por combo.',
  },
  raha_cpa_porcentaje: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 20.00,
    comment: 'CPA proyectado para ventas operadas con Raha.',
  },
  raha_costo_envio: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
    comment: 'Costo promedio de envio por combo operado con Raha.',
  },
  raha_costo_confirmacion: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
    comment: 'Costo de confirmacion por combo operado con Raha.',
  },
  raha_costo_empaque: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
    comment: 'Costo de empaque por combo operado con Raha.',
  },
  // ─── Parámetros de análisis ───────────────────────────────────────────────
  // Array JSON de porcentajes para calcular precios sugeridos.
  // Ej: [15, 30, 45] → el motor calcula precio sugerido para cada margen.
  margenes_objetivo: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: [15, 30, 45],
    comment: 'Array de márgenes objetivo para cálculo de precios recomendados.',
  },
  // Umbral de advertencia. NO es regla de bloqueo.
  // Si margen_combo < margen_minimo, el sistema muestra advertencia pero no bloquea.
  margen_minimo: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 10.00,
    comment: 'Umbral de advertencia de margen. No bloquea, solo advierte.',
  },
  // Umbral para clasificar una oferta como "Excelente" vs "Buena".
  // Excelente: diferencia% > umbral_excelente
  // Buena: 0% < diferencia% <= umbral_excelente
  umbral_excelente: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 50.00,
    comment: 'Umbral % de incremento de utilidad para clasificar oferta como Excelente.',
  },
  // Array JSON de porcentajes para el análisis de sensibilidad.
  // Ej: [0, 5, 10, 15, 20, 25, 30, 35]
  escenarios_descuento: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: [0, 5, 10, 15, 20, 25, 30, 35],
    comment: 'Escenarios de descuento (%) para el análisis de sensibilidad.',
  },
}, {
  tableName: 'combo_configuraciones',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['inquilino_id'] },
  ],
});

module.exports = ComboConfiguracion;
