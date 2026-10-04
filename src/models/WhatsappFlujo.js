const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Flujo de mensajes de WhatsApp: el PROCESO ("Confirmación de pedido",
 * "Recuperación de carrito", "Cobranza"), compuesto por fases ordenadas
 * (WhatsappFlujoFase).
 *
 * El flujo no es una máquina de estados: las fases describen la intención
 * de cada mensaje, no una secuencia obligatoria. El operador puede abrir
 * cualquier fase en cualquier momento y repetirla cuantas veces quiera —
 * cada envío queda registrado en SeguimientoContacto.
 */
const WhatsappFlujo = sequelize.define('WhatsappFlujo', {
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
    type: DataTypes.STRING(120),
    allowNull: false,
  },
  descripcion: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  plantilla_origen_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Plantilla suelta de la que salió este flujo al migrar. NULL en los flujos creados a mano.',
  },
}, {
  tableName: 'whatsapp_flujos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['usuario_id'] },
  ],
});

module.exports = WhatsappFlujo;
