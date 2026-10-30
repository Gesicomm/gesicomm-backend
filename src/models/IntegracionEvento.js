const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Bitácora de la API de integraciones de productos: qué mandó cada
 * proveedor y cuándo. Sirve para soporte ("¿esto lo cargaron ellos o se
 * editó desde el panel?"), no para deduplicar.
 *
 * No hay clave de idempotencia a propósito. El `sku` ya identifica al
 * producto y todas las operaciones fijan un valor absoluto (upsert del
 * producto, stock = N, precio = N, baja): repetir el mismo request deja
 * exactamente el mismo estado, así que un reintento de red es inofensivo
 * por construcción y no hace falta que el socio mande un id de evento.
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
    { fields: ['integracion_id', 'tipo'] },
  ],
});

module.exports = IntegracionEvento;
