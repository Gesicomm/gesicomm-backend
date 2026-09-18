const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Recordatorio de próximo contacto (BE-08/BE-16 a BE-23). PostgreSQL es la
 * fuente de verdad: BullMQ solo dispara el trabajo diferido en el momento
 * indicado, pero el worker siempre reconsulta esta fila antes de notificar.
 *
 * `version` existe para BE-23 (reprogramación): al cambiar ejecutar_en se
 * incrementa, y el job encolado con la versión vieja se descarta al
 * ejecutarse porque ya no coincide con la versión vigente en la base.
 */
const SeguimientoRecordatorio = sequelize.define('SeguimientoRecordatorio', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  envio_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Responsable del próximo contacto.',
  },
  ejecutar_en: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  estado: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'PENDIENTE',
    validate: { isIn: [['PENDIENTE', 'VENCIDO', 'COMPLETADO', 'CANCELADO']] },
  },
  nota: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  version: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  completado_en: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  cancelado_en: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'seguimiento_recordatorios',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['envio_id'] },
    { fields: ['estado', 'ejecutar_en'] },
  ],
});

module.exports = SeguimientoRecordatorio;
