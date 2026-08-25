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
 *   producto, order_bump = ofrecida como agregado en el checkout, combo =
 *   paquete de varios productos a precio fijo ofrecido también en el
 *   checkout, upsell = ofrecida cuando producto_ancla_id ya está en el
 *   carrito). Es una dimensión independiente de tipo_contenido — un combo
 *   puede ser upsell, un pack puede ser order_bump.
 *
 * PRECIOS — son DOS, deliberadamente separados (ver migrations/
 * add_precios_order_bump.sql):
 * - precio_normal: lo que vale la oferta por su canal habitual. Es el
 *   precio de referencia de la reportería.
 * - precio_order_bump: lo que se cobra SOLO si el cliente la acepta como
 *   order bump en el checkout. Antes había un único `precio`, así que
 *   configurar un bump pisaba el precio de venta normal de la misma oferta
 *   y después no se podía saber si una venta salió de un bump o no.
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
    type: DataTypes.ENUM('normal', 'order_bump', 'upsell', 'combo'),
    allowNull: false,
    defaultValue: 'normal',
  },
  precio_normal: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0 },
    comment: 'Precio por el canal habitual (ficha del producto / combo). Referencia para reportería.',
  },
  precio_order_bump: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: { min: 0 },
    comment: 'Precio promocional al aceptarla como order bump en el checkout. NULL = no se ofrece como bump.',
  },
  /**
   * Legado: era el único precio antes de separar normal/order_bump. Se
   * sigue escribiendo en espejo de precio_normal para no romper lecturas
   * viejas (reportes, integraciones). Nada nuevo debería leerlo.
   */
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
  imagen_url: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Imagen propia de la oferta. NULL = se usa la del producto ancla.',
  },
  /**
   * Ventana de vigencia. Fuera de ella la oferta no se muestra ni se puede
   * cobrar, aunque `activo` siga en true — son dos cosas distintas: `activo`
   * es "existe", las fechas son "está corriendo ahora". Cualquiera de las
   * dos en NULL = ese extremo no limita (ver PricingService.ofertaVigente).
   */
  fecha_inicio: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  fecha_fin: {
    type: DataTypes.DATEONLY,
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
