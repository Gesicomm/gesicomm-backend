const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const LeccionEducacion = sequelize.define('LeccionEducacion', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  modulo_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  titulo: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  descripcion: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  url_video: {
    type: DataTypes.STRING(500),
    allowNull: false,
  },
  duracion_min: {
    type: DataTypes.INTEGER,
    defaultValue: 5,
  },
  orden: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
  },
  tipo: {
    type: DataTypes.STRING(50),
    defaultValue: 'video', // 'video', 'articulo', 'recurso'
  },
  recurso_url: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  tableName: 'lecciones_educacion',
  timestamps: true,
});

module.exports = LeccionEducacion;
