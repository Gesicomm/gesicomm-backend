const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Registro de cada acción de seguimiento realizada sobre un pedido (BE-06):
 * el log de envíos del flujo de WhatsApp.
 *
 * Importante: esto registra que el USUARIO abrió el enlace de WhatsApp, no
 * que WhatsApp efectivamente entregó el mensaje — Gesicom no tiene forma de
 * confirmar eso con un deep link. De ahí que `estado` sea
 * ABIERTO_EN_WHATSAPP y no ENVIADO: contar estas filas como "mensajes
 * enviados" sería un dato falso. ENVIADO/ENTREGADO/LEIDO quedan reservados
 * para cuando haya WhatsApp Business API con confirmación real.
 *
 * mensaje_generado y etiqueta_id quedan como snapshot de ese momento,
 * aunque la fase o la etiqueta cambien después.
 *
 * Varias filas con el mismo fase_id son lo normal, no un error: reenviar la
 * Fase 1 tres veces son tres filas. De acá se derivan "última fase abierta",
 * "último envío" y "cantidad de intentos" — no existe ninguna columna
 * fase_actual en el pedido.
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
    comment: 'Legacy: plantilla suelta pre-flujos. Se conserva por el historial viejo; lo nuevo usa fase_id.',
  },
  flujo_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  fase_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  estado: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'ABIERTO_EN_WHATSAPP',
    validate: { isIn: [['ABIERTO_EN_WHATSAPP', 'ENVIADO', 'ENTREGADO', 'LEIDO', 'FALLIDO']] },
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
    { fields: ['envio_id', 'fase_id'] },
  ],
});

module.exports = SeguimientoContacto;
