const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * RESERVADO — log de eventos de una landing pública (clics de contacto,
 * futuros eventos de Meta CAPI). Se crea ahora sin lógica que lo use
 * todavía, para no necesitar una migración el día que se implemente
 * Meta Pixel/CAPI (Fase 4 del plan de landings). No confundir con
 * analítica en tiempo real: es un log simple, también útil como cola de
 * reintentos cuando la Graph API de Meta responda 5xx.
 */
const LandingEvento = sequelize.define('LandingEvento', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  landing_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  tipo_evento: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'Ej: "contacto_whatsapp". Whitelist a definir en Fase 4.',
  },
  // Mismo event_id que se le pasa a fbq() en el navegador. Además de vivir
  // dentro de payload (que se sigue mandando a Meta tal cual), existe como
  // columna propia para poder indexarlo: es la clave de deduplicación.
  // NULL en las 'visita', que no tienen event_id — en Postgres dos NULL no
  // chocan en un índice único, así que conviven sin problema.
  event_id: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  payload: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  enviado_capi: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
}, {
  tableName: 'landing_eventos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['landing_id'] },
    { fields: ['enviado_capi'] },
    // Un doble clic, un reintento del navegador o un reenvío malicioso del
    // mismo body no puede inflar las estadísticas: el segundo INSERT choca
    // acá y se descarta (ver metaCapi.service.js). En bases ya existentes lo
    // crea scripts/migrar-landing-eventos.js — sync() corre con alter:false.
    { fields: ['landing_id', 'event_id'], unique: true, name: 'landing_eventos_landing_event_unico' },
  ],
});

module.exports = LandingEvento;
