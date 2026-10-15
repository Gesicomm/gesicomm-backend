const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

module.exports = sequelize.define('ImportacionSolicitud', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  usuario_id: { type: DataTypes.INTEGER, allowNull: false },
  tienda_id: { type: DataTypes.INTEGER, allowNull: false },
  inquilino_id: { type: DataTypes.INTEGER, allowNull: false },
  producto_url: { type: DataTypes.STRING(2000), allowNull: false },
  cantidad: { type: DataTypes.INTEGER, allowNull: false },
  transporte: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'conveniente' },
  observaciones: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
  estado: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'Pendiente de cotización' },
  clave_idempotencia: { type: DataTypes.UUID, allowNull: false },
  huella: { type: DataTypes.STRING(64), allowNull: false },
}, {
  tableName: 'importacion_solicitudes', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at',
  indexes: [
    { name: 'importacion_solicitudes_idempotencia', unique: true, fields: ['usuario_id', 'tienda_id', 'clave_idempotencia'] },
    { fields: ['inquilino_id', 'estado', 'created_at'] },
  ],
});
