const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Mapeo entre el SKU de un sistema externo y el Producto real de Gesicomm.
 *
 * No se usa `Producto.sku` como clave de sincronización porque esa columna
 * es única por INQUILINO (todo el tenant único comparte el mismo
 * namespace, ver gesicomm-mvp-status), así que dos comercios distintos
 * integrando sus propios SKUs podrían chocar. Esta tabla es la fuente de
 * verdad de "¿este sku_externo de ESTA credencial a qué producto apunta?",
 * igual que SpeedboxPedido mapea order_id externo -> Envio interno.
 */
const IntegracionProducto = sequelize.define('IntegracionProducto', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  integracion_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  sku_externo: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'SKU tal cual lo manda el sistema externo, sin normalizar.',
  },
}, {
  tableName: 'integracion_productos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['integracion_id', 'sku_externo'] },
    { fields: ['producto_id'] },
  ],
});

module.exports = IntegracionProducto;
