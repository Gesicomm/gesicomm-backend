const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Notificación interna leída/no leída en el panel de Gesicom (BE-19).
 * No confundir con NotificationEvent: aquella es la cola de ENVÍOS salientes
 * (emails) con reintentos y proveedor; esta es el aviso que el USUARIO ve
 * dentro de la app. La unique de (tipo, entidad_tipo, entidad_id) es el
 * mecanismo de idempotencia de BE-21: un mismo recordatorio no puede generar
 * dos notificaciones aunque el job se reintente o la reconciliación lo
 * vuelva a encontrar.
 */
const Notificacion = sequelize.define('Notificacion', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  tipo: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  entidad_tipo: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  entidad_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  envio_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Pedido al que navegar desde la notificación (ej. desde la campanita), cuando aplica. No todo tipo de notificación futuro tiene por qué estar atado a un pedido, por eso es independiente de entidad_tipo/entidad_id.',
  },
  titulo: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  mensaje: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  leida: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  leida_en: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'notificaciones',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['usuario_id', 'leida'] },
    // usuario_id va en la unique para poder avisarle del MISMO evento a
    // varios destinatarios (ej. todos los administradores). Sin él, solo
    // entraba la fila del primero.
    { unique: true, fields: ['usuario_id', 'tipo', 'entidad_tipo', 'entidad_id'] },
  ],
});

module.exports = Notificacion;
