const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Etiquetas configurables para identificar la etapa/tipo de seguimiento de
 * un pedido (BE-04). No hardcodeadas: cada usuario/tienda administra su
 * propio catálogo.
 */
const SeguimientoEtiqueta = sequelize.define('SeguimientoEtiqueta', {
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
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'seguimiento_etiquetas',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['usuario_id', 'codigo'] },
  ],
});

module.exports = SeguimientoEtiqueta;
