const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Modelo de Oferta comercial de un producto.
 *
 * Un Producto tiene un único precio base (Producto.precio_base). Una Oferta
 * es una forma ADICIONAL de venderlo (o de venderlo junto a otros productos)
 * con su propio precio — ej. "x2", "x3", "Combo Sueño", "Order Bump Antifaz".
 *
 * - producto_ancla_id: producto en cuya ficha se administra la oferta. No
 *   implica que la oferta solo contenga ese producto — ver OfertaComponente.
 * - codigo: identificador interno estable (ej. "EAR-X3"), independiente del
 *   nombre visible. Sobrevive a un cambio de nombre y es lo que se usa en
 *   analytics/integraciones/debugging en vez de comparar por nombre.
 * - tipo_contenido: QUÉ contiene la oferta (pack = cantidad del mismo
 *   producto, combo = productos distintos agrupados).
 * - estrategia: CÓMO/DÓNDE se presenta (normal = selector en la ficha del
 *   producto, order_bump = ofrecida en el carrito, upsell = ofrecida cuando
 *   producto_ancla_id ya está en el carrito). Es una dimensión independiente
 *   de tipo_contenido — un combo puede ser upsell, un pack puede ser order_bump.
 */
const Oferta = sequelize.define('Oferta', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Aislamiento de tenant',
  },
  producto_ancla_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Producto en cuya ficha se administra esta oferta',
  },
  codigo: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'Identificador interno estable, ej. EAR-X3. No depende del nombre visible.',
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  tipo_contenido: {
    type: DataTypes.ENUM('pack', 'combo'),
    allowNull: false,
    defaultValue: 'pack',
  },
  estrategia: {
    type: DataTypes.ENUM('normal', 'order_bump', 'upsell'),
    allowNull: false,
    defaultValue: 'normal',
  },
  precio: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0 },
  },
  descripcion: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'ofertas_producto',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['inquilino_id'] },
    { fields: ['producto_ancla_id'] },
    { unique: true, fields: ['inquilino_id', 'codigo'] },
  ],
});

module.exports = Oferta;
