const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Asociación entre un pedido y una etiqueta de seguimiento (BE-05). Nunca se
 * borra físicamente al "quitar" una etiqueta: se marca activa=false y se
 * conserva removido_en, para que el historial de seguimiento (BE-11) pueda
 * reconstruir cómo evolucionó el pedido. La etiqueta "actual" de un pedido
 * es el conjunto con activa=true.
 */
const EnvioEtiqueta = sequelize.define('EnvioEtiqueta', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  envio_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  etiqueta_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Quién asignó la etiqueta (puede ser distinto al dueño del pedido si actúa un administrador).',
  },
  origen: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'manual',
    // 'fase' = la aplicó automáticamente una fase del flujo de WhatsApp;
    // 'plantilla' queda para el historial anterior a los flujos.
    validate: { isIn: [['manual', 'plantilla', 'fase']] },
  },
  activa: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  removido_en: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'envio_etiquetas',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['envio_id'] },
    { fields: ['envio_id', 'activa'] },
  ],
});

module.exports = EnvioEtiqueta;
