const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Categoría de un costo o gasto. Mirror de Categoria.js pero con un
 * agrupador fijo (grupo) que arma la taxonomía de la sección 7 del spec
 * (Operación / Administración / Marketing / Tecnología / Financiero / Otros).
 *
 * inquilino_id NULL = categoría global del sistema (seedeada una sola vez,
 * ver categoriaCostoGasto.service.js#seedDefaults). inquilino_id con valor
 * = categoría personalizada creada por ese tenant.
 */
const CategoriaCostoGasto = sequelize.define('CategoriaCostoGasto', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  grupo: {
    type: DataTypes.ENUM('operacion', 'administracion', 'marketing', 'tecnologia', 'financiero', 'otros'),
    allowNull: false,
  },
  nombre: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  slug: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
  },
}, {
  tableName: 'categorias_costos_gastos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = CategoriaCostoGasto;
