const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProgresoUsuarioModulo = sequelize.define('ProgresoUsuarioModulo', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  modulo_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  video_completado: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  examen_aprobado: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  puntaje_obtenido: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Puntaje en porcentaje (0-100)',
  },
  intentos: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  completado: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'true cuando tanto video como examen están completados/aprobados',
  },
  fecha_completado: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'progreso_usuario_modulos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = ProgresoUsuarioModulo;
