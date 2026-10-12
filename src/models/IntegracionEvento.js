const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Bitácora de idempotencia de la API de integraciones de productos.
 * Mismo patrón que SpeedboxEvento: cada request mutante (upsert, stock,
 * precio, baja) se registra con una `event_key` única por credencial antes
 * de aplicarse, para que un reintento de red del sistema externo nunca
 * duplique el efecto. Ver integracionProductos.service.js#ingest.
 */
const IntegracionEvento = sequelize.define('IntegracionEvento', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  integracion_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  event_key: {
    type: DataTypes.STRING(180),
    allowNull: false,
    comment: '"id:<event_id>" si lo mandó el cliente, o "hash:<sha256>" del payload si no.',
  },
  tipo: {
    type: DataTypes.STRING(40),
    allowNull: false,
    comment: 'producto.upsert | producto.stock | producto.precio | producto.baja',
  },
  sku_externo: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  estado: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'procesado',
    comment: 'procesado | error',
  },
  detalle: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  payload: {
    type: DataTypes.JSONB,
    allowNull: false,
  },
}, {
  tableName: 'integracion_eventos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['integracion_id', 'event_key'] },
    { fields: ['integracion_id', 'tipo'] },
  ],
});

module.exports = IntegracionEvento;
