const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ModuloEducacion = sequelize.define('ModuloEducacion', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  titulo: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  descripcion: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  video_url: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  duracion_minutos: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 10,
  },
  icono: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: '🎓',
  },
  color_accent: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: '#3b82f6',
  },
  estado: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'publicado', // 'publicado', 'borrador', 'construccion'
  },
  recursos_descarga: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: [],
  },
  menu_desbloqueado: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Identificador del menú del sidebar que se desbloquea al aprobar este módulo (ej: mi-landing, productos, pedidos, ads)',
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'modulos_educacion',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = ModuloEducacion;
