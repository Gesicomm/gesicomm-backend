const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Suscripción de un cliente a un plan de Gesicomm.
 *
 * La pieza clave del diseño es que `usuario_id` es NULLABLE, y el motivo es
 * el orden del flujo pedido: la persona entra a la landing, elige plan y
 * PAGA — y recién después se registra. En el momento del pago todavía no
 * existe ningún Usuario al que colgar la suscripción.
 *
 * Por eso la identidad durante esa ventana es el `email` (lo único que se le
 * pide antes de pagar). Cuando el pago se acredita se emite un
 * `token_registro`, y con ese token la persona completa el alta: ahí recién
 * se crea el Usuario y se rellena `usuario_id`.
 *
 * `email` no es único a propósito: alguien puede pagar, no completar el
 * registro, y volver a intentarlo más adelante. Lo que manda es la
 * suscripción con estado 'activa' más reciente.
 */
const Suscripcion = sequelize.define('Suscripcion', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  plan_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Null hasta que la persona completa el registro con el token. Ver comentario de cabecera.',
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Correo declarado antes de pagar. Es la identidad de la suscripción mientras no haya Usuario.',
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: true,
    comment: 'Nombre declarado antes de pagar, para precargar el formulario de registro.',
  },
  estado: {
    type: DataTypes.ENUM('pendiente_pago', 'activa', 'vencida', 'cancelada'),
    allowNull: false,
    defaultValue: 'pendiente_pago',
    comment: 'pendiente_pago = se inició el checkout pero PagoPar todavía no confirmó.',
  },
  precio_pagado: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Snapshot del precio al momento de contratar, en guaraníes. Si el plan cambia de precio, esta suscripción no se altera.',
  },
  periodo_inicio: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Se completa cuando el pago se acredita.',
  },
  periodo_fin: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Hasta cuándo tiene acceso pago. Null = sin vencimiento calculado todavía.',
  },
  token_registro: {
    type: DataTypes.STRING(64),
    allowNull: true,
    unique: true,
    comment: 'Token de un solo uso que habilita completar el registro. Se emite al acreditarse el pago y se anula al usarse.',
  },
  token_registro_expira: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  afiliado_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Afiliado que refirió esta suscripción, si llegó con un link ?ref=.',
  },
  afiliado_codigo: {
    type: DataTypes.STRING(80),
    allowNull: true,
    comment: 'Snapshot del código usado al contratar, para auditoría aunque el afiliado cambie el código.',
  },
}, {
  tableName: 'suscripciones',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['email'] },
    { fields: ['usuario_id'] },
    { fields: ['estado'] },
    { fields: ['afiliado_id'] },
  ],
});

module.exports = Suscripcion;
