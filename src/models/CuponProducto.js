const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Qué productos alcanza un cupón cuyo `alcance` es 'productos'.
 *
 * Para un cupón de alcance 'tienda' esta tabla queda vacía: no se listan
 * todos los productos del catálogo, porque entonces agregar un producto
 * nuevo obligaría a tocar todos los cupones existentes.
 */
const CuponProducto = sequelize.define('CuponProducto', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  cupon_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
}, {
  tableName: 'cupon_productos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['cupon_id', 'producto_id'] },
    { fields: ['producto_id'] },
  ],
});

module.exports = CuponProducto;
