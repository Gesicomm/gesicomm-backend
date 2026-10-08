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
  tienda_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Tienda dueña del producto cuando lo carga un comercio. Nullable para catálogo global/admin y filas antiguas.',
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
  proveedor_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'FK al Proveedor (opcional, para reportes y filtros)',
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
  sobre_este_producto: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  propuesta_valor: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  beneficios: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: [],
  },
  confianza: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: [],
  },
  preguntas_frecuentes: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: [],
  },
  faq_titulo: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  relacionados_titulo: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Título de "Productos relacionados" en la página del producto. null = default genérico.',
  },
  /**
   * Qué juego de campos usa la ficha de este producto. Existe porque la
   * página de producto de cada template rígido pide información distinta:
   * suplementos necesita ingredientes con su dosis, electrónica necesita
   * especificaciones, "en la caja" y una comparativa. No es lo mismo que
   * `tipo_producto` (físico/digital), que es otra dimensión.
   *
   * Texto y no ENUM a propósito: sumar un rubro sería otra migración y la
   * lista la maneja la aplicación. null = genérico, se comporta como antes.
   */
  ficha_rubro: {
    type: DataTypes.STRING(40),
    allowNull: true,
  },
  /**
   * Campos propios del rubro, con la forma que define el frontend (ver
   * templates/tech/fichaTech.js y templates/fitness/fichaFitness.js). JSON
   * y no columnas sueltas porque cada rubro tiene su juego de campos y van
   * a seguir apareciendo rubros: una columna por campo obliga a migrar
   * cada vez.
   */
  ficha_datos: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
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
  precio_dolar: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'Costo del producto en USD (precio de compra al proveedor). Base para recalcular precio_costo/precio_base cuando cambia la cotización.',
  },
  es_dolar: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false,
    comment: 'Si es true, el costo base es en dolares y se calcula en guaranies según el precio_dolar del proveedor.',
  },
  precio_tachado: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'Precio ancla: precio de referencia que se muestra tachado en la landing para indicar oferta. Ej: producto costaba 300.000, ahora sale 220.000.',
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
    comment: 'Stock vendible = stock_salon + stock_deposito. Lo mantiene el backend. Si hay variantes, es la suma de sus stocks.',
  },
  // Mismo desglose que ProductoVariante: dónde está físicamente la
  // mercadería. Online se vende el TOTAL (los dos juntos) — tener unidades
  // en depósito no puede frenar una venta. Lo que sí cambia es de dónde
  // sale: primero el salón, y recién cuando se agota, el depósito (ver
  // envioController.descontarStockYSnapshot).
  stock_salon: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    comment: 'Unidades en el mostrador. Es de donde sale primero una venta.',
  },
  stock_deposito: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    comment: 'Unidades guardadas. Se venden igual: el stock online es la suma de ambos.',
  },
  stock_minimo_salon: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Aviso de REPOSICIÓN: cuándo mover mercadería del depósito al salón. Distinto de stock_minimo, que avisa antes de quedarse sin nada.',
  },
  stock_minimo: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    comment: 'Umbral para alertas de reposición.',
  },
  cantidad_reservada: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    comment: 'Comprometido por pedidos Confirmados/Preparados, todavía físicamente en el depósito. No se descuenta de cantidad_disponible dos veces — ver envioController.',
  },
  cantidad_transito: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
    comment: 'Salió del depósito con un courier (pedido Despachado), pendiente de Entregado/Devuelto/Perdido.',
  },
  unidad_medida: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'unidad',
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
    comment: 'Soft-delete. false = producto dado de baja, nunca se borra físicamente.',
  },
  estado_venta: {
    type: DataTypes.ENUM('en_venta', 'fuera_de_stock', 'no_disponible'),
    defaultValue: 'en_venta',
    allowNull: false,
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
    { fields: ['tienda_id'] },
  ],
});

module.exports = Producto;
