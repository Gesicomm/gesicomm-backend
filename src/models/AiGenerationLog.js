const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Una fila por cada llamada a crearDesdeIA/regenerarConIA (ver
 * aiLanding.service.js) — la telemetría de "qué tan buenas son las
 * landings, no solo si compilan": qué prompts fallan, cuántos repairs se
 * usan, latencia y costo (tokens) por generación.
 */
const AiGenerationLog = sequelize.define('AiGenerationLog', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  tienda_id: { type: DataTypes.INTEGER, allowNull: false },
  landing_id: { type: DataTypes.INTEGER, allowNull: true },
  operacion: { type: DataTypes.STRING, allowNull: false }, // 'generate' | 'edit'
  page_type: { type: DataTypes.STRING, allowNull: false }, // 'landing' | 'product'
  target: { type: DataTypes.STRING, allowNull: true }, // 'inicio' | 'producto' | 'producto_especifico'
  content_id: { type: DataTypes.STRING, allowNull: true },
  prompt: { type: DataTypes.TEXT, allowNull: false },
  modelo: { type: DataTypes.STRING, allowNull: true },
  latencia_ms: { type: DataTypes.INTEGER, allowNull: true },
  tokens_input: { type: DataTypes.INTEGER, allowNull: true },
  tokens_output: { type: DataTypes.INTEGER, allowNull: true },
  repair_used: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  exitoso: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  validation_errors: { type: DataTypes.JSONB, allowNull: true },
  validation_errors_pre_repair: { type: DataTypes.JSONB, allowNull: true },
}, {
  tableName: 'ai_generation_logs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = AiGenerationLog;
