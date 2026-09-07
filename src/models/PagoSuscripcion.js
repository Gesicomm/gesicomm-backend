const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Cada intento de cobro de una suscripción contra PagoPar.
 *
 * Es deliberadamente una tabla aparte de `payment_transactions`, que existe
 * desde antes y está atada a `envio_id NOT NULL` — o sea, a un pedido de una
 * tienda. Una suscripción no tiene pedido, así que forzarla ahí obligaría a
 * hacer `envio_id` nullable y a que el webhook adivine de qué tipo de cobro
 * está hablando. Dos tablas, dos webhooks, cero ambigüedad.
 *
 * `hash_pedido` es el identificador que devuelve PagoPar al iniciar la
 * transacción, y es lo que permite reconciliar después: es el único dato que
 * viaja en las dos direcciones.
 */
const PagoSuscripcion = sequelize.define('PagoSuscripcion', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  suscripcion_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  provider: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'pagopar',
  },
  referencia: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'El id_pedido_comercio que le mandamos a PagoPar. Es el único identificador que generamos nosotros.',
  },
  hash_pedido: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Hash devuelto por PagoPar al iniciar la transacción. Clave para reconciliar el callback.',
  },
  estado: {
    type: DataTypes.ENUM('PENDING', 'PAID', 'FAILED'),
    allowNull: false,
    defaultValue: 'PENDING',
  },
  monto: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'En guaraníes, sin decimales.',
  },
  pagado_en: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  respuesta_pasarela: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: 'Payload crudo del callback o de la consulta de estado, para auditoría y soporte.',
  },
}, {
  tableName: 'pagos_suscripcion',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['suscripcion_id'] },
    { fields: ['hash_pedido'] },
    { unique: true, fields: ['referencia'] },
  ],
});

module.exports = PagoSuscripcion;
