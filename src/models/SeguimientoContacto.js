const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Registro de cada acción de seguimiento realizada sobre un pedido (BE-06).
 * Importante: esto registra que el USUARIO abrió/envió el enlace de
 * WhatsApp, no que WhatsApp efectivamente entregó el mensaje — Gesicom no
 * tiene forma de confirmar eso con un deep link. mensaje_generado y
 * etiqueta_id quedan como snapshot de ese momento, aunque la plantilla o la
 * etiqueta cambien después.
 */
const SeguimientoContacto = sequelize.define('SeguimientoContacto', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  envio_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  plantilla_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  etiqueta_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  telefono: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  mensaje_generado: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  canal: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'WHATSAPP',
  },
}, {
  tableName: 'seguimiento_contactos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['envio_id'] },
  ],
});

module.exports = SeguimientoContacto;
