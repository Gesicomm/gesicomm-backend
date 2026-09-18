const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Plantillas reutilizables de mensajes de WhatsApp para el seguimiento de
 * pedidos (RF Seguimiento de pedidos por WhatsApp, BE-02/BE-03). El mensaje
 * se guarda con variables sin resolver (ej. {{nombre}}); la resolución con
 * los datos reales del pedido la hace whatsappPlantilla.service.js recién
 * al usar la plantilla, nunca acá.
 */
const WhatsappPlantilla = sequelize.define('WhatsappPlantilla', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  nombre: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  codigo: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  mensaje: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  etiqueta_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Etiqueta que se aplica automáticamente al pedido cuando se usa esta plantilla (BE-05).',
  },
}, {
  tableName: 'whatsapp_plantillas',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['usuario_id', 'codigo'] },
  ],
});

module.exports = WhatsappPlantilla;
