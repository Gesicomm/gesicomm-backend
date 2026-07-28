const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Modelo de Categoría.
 * Soporta jerarquía mediante auto-referencia (parent_id).
 * Un producto apunta siempre a la categoría hoja; la ruta completa
 * se arma navegando parent_id hacia arriba.
 */
const Categoria = sequelize.define('Categoria', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  parent_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null,
    comment: 'Auto-referencia para subcategorías. NULL = categoría raíz.',
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  slug: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
  },
}, {
  tableName: 'categorias',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    // Slug único por inquilino
    { unique: true, fields: ['slug', 'inquilino_id'] },
  ],
});

module.exports = Categoria;
