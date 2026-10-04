'use strict';

const { DataTypes, Op } = require('sequelize');
const sequelize = require('../config/database');

/**
 * InventarioUbicacion
 * 
 * Persiste el estado actual del stock físico de un producto/variante en una ubicación específica.
 * Es la fuente de verdad de "qué mercadería tiene actualmente X ubicación", ya sea
 * propia del comercio (alcance='PROPIO') o de la red de fulfillment (alcance='GESICOMM').
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
    comment: 'Dónde está físicamente la mercadería. Puede apuntar a salón, depósito propio o centro Gesicomm.',
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
