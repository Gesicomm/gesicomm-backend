const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Modelo principal de Producto.
 *
 * Notas importantes:
 * - cantidad_disponible: Si el producto tiene variantes, este campo
 *   es calculado (suma de stocks de variantes) y no debe editarse directamente.
 * - precio_costo: Solo se expone en respuestas a usuarios con rol admin (serializer en controller).
 * - slug: Único por inquilino. Generado automáticamente, editable manualmente.
 * - activo: Se usa para soft-delete. Nunca se borra físicamente un producto.
 */
const Producto = sequelize.define('Producto', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  nombre: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  sku: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  categoria_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'FK a la categoría hoja. La jerarquía se navega vía parent_id de Categoria.',
  },
  marca_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  tags: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: [],
  },
  descripcion_corta: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  descripcion_larga: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  // --- Precios ---
  precio_costo: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'Solo visible para administradores. Nunca se expone en respuestas a no-admin.',
  },
  precio_minimo: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'El precio efectivo (con descuentos) nunca puede caer por debajo de este valor.',
  },
  precio_base: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
  },
  descuento_porcentaje: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    defaultValue: 0,
    comment: 'Descuento en porcentaje. Solo se aplica si la fecha actual está dentro del rango.',
  },
  descuento_inicio: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  descuento_fin: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  impuestos_incluidos: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
  },
  // --- Stock ---
  cantidad_disponible: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    comment: 'Si hay variantes, este campo es calculado automáticamente. No editar directamente.',
  },
  stock_minimo: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    comment: 'Umbral para alertas de reposición.',
  },
  unidad_medida: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'unidad',
  },
  // --- Estado ---
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
    comment: 'Soft-delete. false = producto dado de baja, nunca se borra físicamente.',
  },
  destacado: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false,
  },
  fecha_disponible_desde: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  fecha_disponible_hasta: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // --- SEO ---
  slug: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  meta_titulo: {
    type: DataTypes.STRING(160),
    allowNull: true,
  },
  meta_descripcion: {
    type: DataTypes.STRING(320),
    allowNull: true,
  },
  // --- Logística ---
  peso: {
    type: DataTypes.DECIMAL(8, 3),
    allowNull: true,
    comment: 'En kilogramos.',
  },
  dimensiones: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Formato libre, ej: "30x20x10 cm".',
  },
  tipo_producto: {
    type: DataTypes.ENUM('fisico', 'digital'),
    defaultValue: 'fisico',
    allowNull: false,
  },
  // --- Auditoría ---
  creado_por: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'FK a Usuario.',
  },
  modificado_por: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'FK a Usuario.',
  },
}, {
  tableName: 'productos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    // SKU único por inquilino
    { unique: true, fields: ['sku', 'inquilino_id'], where: { sku: { [require('sequelize').Op.ne]: null } } },
    // Slug único por inquilino
    { unique: true, fields: ['slug', 'inquilino_id'] },
    // Índice de búsqueda frecuente
    { fields: ['inquilino_id', 'activo'] },
  ],
});

module.exports = Producto;
