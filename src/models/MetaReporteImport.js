const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Una subida de reporte CSV de Meta Ads Manager (metadata del archivo,
 * no las filas — ver MetaReporteFila). Sirve para mostrar historial de
 * importaciones y para poder "deshacer" una importación completa si el
 * usuario subió el archivo equivocado.
 */
const MetaReporteImport = sequelize.define('MetaReporteImport', {
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
  },
  nombre_archivo: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  fecha_inicio_reporte: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Columna "Inicio del informe" de la primera fila del CSV.',
  },
  fecha_fin_reporte: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  filas_totales: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  filas_matcheadas: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  filas_sin_match: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'meta_reporte_imports',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['inquilino_id'] },
  ],
});

module.exports = MetaReporteImport;
