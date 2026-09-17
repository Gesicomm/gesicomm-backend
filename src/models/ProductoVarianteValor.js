const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Tabla puente pura: qué combinación de ProductoOpcionValor forma una
 * ProductoVariante concreta. Sin datos propios más allá de las dos FKs
 * (mismo criterio que RolPermiso) — se resincroniza completa (destroy +
 * bulkCreate) cada vez que se guardan las variantes de un producto.
 */
const ProductoVarianteValor = sequelize.define('ProductoVarianteValor', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  variante_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  opcion_valor_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
}, {
  tableName: 'producto_variante_valores',
  timestamps: false,
  indexes: [
    { fields: ['variante_id'] },
    { fields: ['opcion_valor_id'] },
    { unique: true, fields: ['variante_id', 'opcion_valor_id'] },
  ],
});

module.exports = ProductoVarianteValor;
