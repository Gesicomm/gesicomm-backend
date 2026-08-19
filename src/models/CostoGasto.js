const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Registro de costo o gasto del negocio (módulo Finanzas → Costos y Gastos).
 *
 * Escopado por usuario_id (no inquilino_id): es un registro financiero
 * operativo, igual que Envio/MetodoPago/Liquidacion, no catálogo compartido
 * — así el resumen de este módulo se puede cruzar directo con las ventas
 * (Envio) de pedidosAnalyticsService, que también filtran por usuario_id.
 *
 * Recurrencia: una fila "plantilla" tiene es_recurrente=true y
 * parent_recurring_id=null; el job de src/services/cron/costosRecurrentes.job.js
 * genera ocurrencias concretas (es_recurrente=false, parent_recurring_id
 * apuntando a la plantilla) cuando llega proxima_fecha, y avanza
 * proxima_fecha de la plantilla a la siguiente.
 */
const CostoGasto = sequelize.define('CostoGasto', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  tipo: {
    type: DataTypes.ENUM('costo', 'gasto'),
    allowNull: false,
  },
  categoria_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  concepto: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  descripcion: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  importe: {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
  },
  moneda: {
    type: DataTypes.STRING(3),
    allowNull: false,
    defaultValue: 'PYG',
    comment: 'No existe configuración de moneda a nivel de negocio en el sistema todavía; se guarda por registro con default PYG.',
  },
  fecha: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  fecha_pago: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  estado: {
    type: DataTypes.ENUM('pendiente', 'pagado', 'cancelado'),
    allowNull: false,
    defaultValue: 'pendiente',
  },
  clasificacion: {
    type: DataTypes.ENUM('fijo', 'variable'),
    allowNull: true,
  },
  es_recurrente: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  frecuencia: {
    type: DataTypes.ENUM('semanal', 'quincenal', 'mensual', 'trimestral', 'semestral', 'anual'),
    allowNull: true,
  },
  proxima_fecha: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Solo se usa en la fila plantilla (parent_recurring_id null) de un gasto recurrente.',
  },
  parent_recurring_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'FK a la fila plantilla que generó esta ocurrencia. Null si es un registro único o la plantilla misma.',
  },
  metodo_pago_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  proveedor_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  variante_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  envio_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Asociación opcional a la venta/pedido que originó este costo.',
  },
  comprobante_url: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  comprobante_nombre: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
    comment: 'Soft-delete: nunca se borra físicamente un costo/gasto para no perder trazabilidad de reportes.',
  },
}, {
  tableName: 'costos_gastos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['usuario_id', 'fecha'] },
    { fields: ['usuario_id', 'tipo'] },
    { fields: ['usuario_id', 'es_recurrente', 'proxima_fecha'] },
  ],
});

module.exports = CostoGasto;
