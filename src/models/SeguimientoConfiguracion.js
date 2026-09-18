const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Configuración por usuario/tienda de los tiempos rápidos para programar el
 * próximo seguimiento (BE-09), ej. [1, 2, 4, 8, 24] horas. Aparte, siempre
 * se puede elegir fecha/hora manual — este catálogo es solo para los
 * accesos rápidos del selector.
 */
const SeguimientoConfiguracion = sequelize.define('SeguimientoConfiguracion', {
  usuario_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
  },
  tiempos_rapidos_horas: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [1, 2, 4, 8, 24],
  },
}, {
  tableName: 'seguimiento_configuraciones',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = SeguimientoConfiguracion;
