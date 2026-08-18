const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * "Campaña interna" de Meta Ads — se crea ACÁ antes de existir en Meta.
 *
 * Flujo: el usuario elige producto(s) + un funnel (Landing) propios, el
 * sistema genera `codigo` (corto, único) y `nombre_interno` (el texto
 * completo, con el código embebido entre corchetes). El usuario copia
 * `nombre_interno` como nombre real de la campaña en Meta Ads Manager.
 *
 * Cuando después se sube un reporte CSV de Meta (ver MetaReporteFila), se
 * busca el patrón `[GSC-XXXXXX]` dentro del nombre de campaña de cada fila
 * y se matchea contra `codigo` — así una fila de reporte queda vinculada a
 * este registro sin depender de ningún ID de Meta. Por eso `codigo` es
 * inmutable una vez creado (romper el código rompe el matching histórico).
 *
 * `producto_ids` es JSON (array de enteros), mismo criterio que
 * Producto.tags — no amerita una tabla intermedia para esto todavía; si
 * una campaña cubre varios productos, cada producto ve el 100% de las
 * métricas de esa campaña en el agregado por producto (no se prorratea).
 */
const MetaCampanaInterna = sequelize.define('MetaCampanaInterna', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  meta_integration_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'FK a MetaIntegration (el BM/cuenta de Meta a la que pertenece esta campaña). Nullable: se puede crear antes de conectar Meta.',
  },
  landing_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Funnel elegido para la campaña (FK a Landing). Nullable por si el usuario todavía no armó el funnel.',
  },
  producto_ids: {
    // JSONB (no JSON): se filtra por Op.contains ("@>") en el service —
    // ese operador de Postgres solo existe para jsonb, no para json plano.
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
    comment: 'Array de IDs de Producto incluidos en esta campaña.',
  },
  tipo: {
    type: DataTypes.ENUM('whatsapp', 'web'),
    allowNull: false,
    defaultValue: 'web',
    comment: 'Canal principal de la campaña, elegido a mano al crearla (todavía no existe en Meta para poder derivarlo del objective, a diferencia de la tabla "en vivo").',
  },
  codigo: {
    type: DataTypes.STRING(12),
    allowNull: false,
    unique: true,
    comment: 'Token corto embebido en nombre_interno, usado para matchear filas de reporte. Inmutable.',
  },
  nombre_interno: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    comment: 'Texto completo a copiar como nombre de campaña en Meta Ads Manager, ej: "[GSC-A3F9K1] Cejas - The Converter".',
  },
  nombre_display: {
    type: DataTypes.STRING(150),
    allowNull: false,
    comment: 'Nombre corto que el usuario eligió (sin el código), usado en la UI de Gesicomm.',
  },
  estado: {
    type: DataTypes.ENUM('borrador', 'activa', 'pausada', 'archivada'),
    allowNull: false,
    defaultValue: 'borrador',
  },
  meta_campaign_id: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'ID real de campaña en Graph API, si algún día se linkea automáticamente. Hoy solo informativo.',
  },
  notas: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'meta_campanas_internas',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['inquilino_id'] },
    { fields: ['usuario_id'] },
    { fields: ['meta_integration_id'] },
  ],
});

module.exports = MetaCampanaInterna;
