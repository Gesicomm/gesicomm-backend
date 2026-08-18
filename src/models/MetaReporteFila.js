const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Una fila del reporte CSV exportado desde Meta Ads Manager (export
 * "Rendimiento de campaña" en español — ver src/utils/csvParser.js y
 * metaReportes.service.js para el mapeo de columnas).
 *
 * `meta_campana_interna_id` es nullable: si el nombre de campaña del CSV
 * no trae el código `[GSC-XXXXXX]` (o no matchea ninguna campaña interna
 * existente), la fila igual se guarda — aparece en la UI como "sin
 * vincular" y se puede mapear manualmente después (ver PUT /filas/:id/vincular).
 *
 * Los campos numéricos mapeados cubren las columnas más comunes del
 * export en español. `datos_crudos` guarda la fila completa tal cual
 * vino (header original -> valor), para no perder columnas no mapeadas
 * y para poder re-derivar campos si Meta cambia el formato del export.
 */
const MetaReporteFila = sequelize.define('MetaReporteFila', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  meta_reporte_import_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  meta_campana_interna_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  nombre_campana_meta: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Columna "Nombre de la campaña" tal cual vino en el CSV.',
  },
  codigo_matcheado: {
    type: DataTypes.STRING(12),
    allowNull: true,
    comment: 'Código [GSC-XXXXXX] extraído del nombre, si lo tenía.',
  },
  fecha_inicio: { type: DataTypes.DATEONLY, allowNull: true },
  fecha_fin: { type: DataTypes.DATEONLY, allowNull: true },
  entrega: { type: DataTypes.STRING(50), allowNull: true, comment: 'Columna "Entrega de la campaña" (active/archived/etc).' },
  presupuesto: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  tipo_presupuesto: { type: DataTypes.STRING(50), allowNull: true },
  importe_gastado: { type: DataTypes.DECIMAL(14, 2), allowNull: true, defaultValue: 0 },
  resultados: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  indicador_resultado: { type: DataTypes.STRING(150), allowNull: true },
  costo_por_resultado: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
  alcance: { type: DataTypes.INTEGER, allowNull: true },
  impresiones: { type: DataTypes.INTEGER, allowNull: true },
  cpm: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
  clics_enlace: { type: DataTypes.INTEGER, allowNull: true },
  cpc: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
  ctr: { type: DataTypes.DECIMAL(8, 4), allowNull: true },
  visitas_pagina: { type: DataTypes.INTEGER, allowNull: true },
  costo_por_visita: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
  pagos_iniciados: { type: DataTypes.INTEGER, allowNull: true },
  costo_por_pago_iniciado: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
  valor_conversion_compras: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  roas: { type: DataTypes.DECIMAL(10, 4), allowNull: true },
  compras: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
  costo_por_compra: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
  frecuencia: { type: DataTypes.DECIMAL(8, 4), allowNull: true },
  pct_compra_por_visita: { type: DataTypes.DECIMAL(8, 4), allowNull: true },
  pct_visita_por_clic: { type: DataTypes.DECIMAL(8, 4), allowNull: true },
  datos_crudos: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: 'Fila completa del CSV, header original -> valor string, para no perder columnas no mapeadas.',
  },
}, {
  tableName: 'meta_reporte_filas',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['inquilino_id'] },
    { fields: ['meta_reporte_import_id'] },
    { fields: ['meta_campana_interna_id'] },
    { fields: ['codigo_matcheado'] },
  ],
});

module.exports = MetaReporteFila;
