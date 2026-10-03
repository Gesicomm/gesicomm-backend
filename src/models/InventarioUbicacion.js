'use strict';

const { DataTypes, Op } = require('sequelize');
const sequelize = require('../config/database');

/**
 * InventarioUbicacion
 * 
 * Persiste el estado actual del stock físico de un producto/variante en un depósito específico.
 * Es la fuente de verdad de "qué mercadería tiene actualmente X depósito", ya sea
 * del comercio (alcance='COMERCIO') o de la red de fulfillment (alcance='GESICOMM').
 */
const InventarioUbicacion = sequelize.define('InventarioUbicacion', {
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Dueño de la mercadería (El Comercio).',
  },
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  variante_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  deposito_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Dónde está físicamente la mercadería. Puede apuntar a un Centro Gesicomm o a un depósito propio.',
  },
  cantidad_disponible: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    comment: 'Cantidad física lista para la venta.',
  },
  cantidad_reservada: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    comment: 'Unidades comprometidas en pedidos no despachados.',
  },
}, {
  tableName: 'inventario_ubicaciones',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['usuario_id', 'producto_id', 'variante_id', 'deposito_id'],
      where: { variante_id: { [Op.ne]: null } },
      name: 'idx_inventario_propietario_variante',
    },
    {
      unique: true,
      fields: ['usuario_id', 'producto_id', 'deposito_id'],
      where: { variante_id: null },
      name: 'idx_inventario_propietario_simple',
    },
    {
      fields: ['usuario_id', 'deposito_id'],
    }
  ],
});

module.exports = InventarioUbicacion;
