const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Fase de un flujo de WhatsApp: un mensaje con una intención ("Primer
 * contacto", "Recordatorio", "Último intento") y una posición en el flujo.
 *
 * El mensaje se guarda con variables sin resolver (ej. {{cliente_nombre}});
 * la resolución con los datos reales del pedido la hace
 * plantillaResolver.service.js recién al abrir la fase, nunca acá.
 *
 * `espera_sugerida_minutos` es SUGERIDA, no obligatoria: sirve para que el
 * panel del pedido ofrezca agendar el recordatorio ("¿te recordamos en 4
 * horas?") después de abrir una fase. Nunca dispara un mensaje solo —
 * mientras el canal sea un deep link wa.me, el envío siempre lo hace una
 * persona. 0 = inmediata / sin sugerencia.
 *
 * Una fase nunca se "consume": abrirla no la bloquea ni avanza nada. Por
 * eso no hay ninguna columna de estado acá — lo que pasó con cada fase en
 * cada pedido se deriva de SeguimientoContacto.
 */
const WhatsappFlujoFase = sequelize.define('WhatsappFlujoFase', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  flujo_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  nombre: {
    type: DataTypes.STRING(120),
    allowNull: false,
  },
  mensaje: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  espera_sugerida_minutos: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Minutos sugeridos desde la fase anterior. 0 = inmediata. Solo alimenta la sugerencia de recordatorio.',
  },
  etiqueta_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Etiqueta que se aplica automáticamente al pedido cuando se abre esta fase (BE-05).',
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: 'Una fase que ya tiene envíos registrados se desactiva en vez de borrarse, para no perder el historial.',
  },
}, {
  tableName: 'whatsapp_flujo_fases',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['flujo_id', 'orden'] },
  ],
});

module.exports = WhatsappFlujoFase;
