const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Cupón de descuento que el comercio entrega a sus clientes y que se
 * canjea escribiendo el código en el checkout de la landing.
 *
 * No se pisa con los otros descuentos que ya existen:
 * - Producto.descuento_porcentaje es un descuento por FECHA, automático y
 *   para todo el mundo (lo aplica PricingService sin que nadie haga nada).
 * - Oferta es una presentación distinta del producto (pack x3, combo).
 * - El cupón lo tiene que escribir el comprador: es la única de las tres
 *   que depende de una acción suya, y por eso vive aparte.
 *
 * El descuento es siempre un porcentaje y NUNCA perfora `precio_minimo`
 * del producto — el piso que fija el admin manda sobre el cupón (ver
 * CuponService.calcularDescuento).
 */
const Cupon = sequelize.define('Cupon', {
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
    comment: 'Comercio dueño del cupón. El código es único por comercio, no global.',
  },
  codigo: {
    type: DataTypes.STRING(40),
    allowNull: false,
    comment: 'Lo que escribe el comprador. Se guarda y se compara en MAYÚSCULAS y sin espacios.',
  },
  descuento_porcentaje: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    validate: { min: 0.01, max: 100 },
  },
  alcance: {
    type: DataTypes.ENUM('tienda', 'productos'),
    allowNull: false,
    defaultValue: 'tienda',
    comment: "'tienda' descuenta todo el pedido; 'productos' solo los de CuponProducto.",
  },
  fecha_vencimiento: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'null = no vence. Se compara contra la fecha de Asunción, inclusive.',
  },
  max_usos: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'null = usos ilimitados.',
  },
  usos: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Se incrementa al crearse el pedido que lo usó, no al validarlo.',
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: 'Corte manual: apaga el cupón sin borrarlo, para no perder el historial.',
  },
}, {
  tableName: 'cupones',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    // Un mismo código puede existir en dos comercios distintos: lo que no
    // puede haber es dos cupones con el mismo código en el mismo comercio.
    { unique: true, fields: ['usuario_id', 'codigo'] },
    { fields: ['inquilino_id'] },
  ],
});

module.exports = Cupon;
