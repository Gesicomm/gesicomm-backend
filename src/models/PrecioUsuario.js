const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Precio propio que un usuario (rol 'usuario') define para un producto o
 * combo del catálogo, de cara a su propia landing.
 *
 * No reemplaza a Producto.precio_base / ProductoCombo.precio_total —
 * esos son el precio de referencia que fija el admin. Este registro es
 * la personalización por usuario, validada en el service para que nunca
 * caiga por debajo del precio_minimo configurado por el admin.
 */
const PrecioUsuario = sequelize.define('PrecioUsuario', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Aislamiento de tenant.',
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  tipo: {
    type: DataTypes.ENUM('producto', 'combo'),
    allowNull: false,
  },
  referencia_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'FK a Producto.id o ProductoCombo.id según "tipo".',
  },
  precio: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    validate: { min: 0 },
  },
  categoria_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Categoria interna que el usuario asigna a este item en su propia vitrina.',
  },
}, {
  tableName: 'precios_usuario',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['usuario_id', 'tipo', 'referencia_id'] },
    { fields: ['inquilino_id'] },
  ],
});

module.exports = PrecioUsuario;
