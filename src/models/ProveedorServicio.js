const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProveedorServicio = sequelize.define('ProveedorServicio', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  solicitud_id: { type: DataTypes.INTEGER, allowNull: false },
  categoria: { type: DataTypes.STRING(50), allowNull: false },
  titulo: { type: DataTypes.STRING(120), allowNull: false, defaultValue: 'Nuevo servicio' },
  resumen: { type: DataTypes.STRING(500), allowNull: false, defaultValue: '' },
  detalle_html: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
  beneficios: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  video_urls: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  imagenes: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  estado: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'borrador' },
}, {
  tableName: 'proveedor_servicios', timestamps: true,
  createdAt: 'created_at', updatedAt: 'updated_at',
});

module.exports = ProveedorServicio;
