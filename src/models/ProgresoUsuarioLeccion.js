const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProgresoUsuarioLeccion = sequelize.define('ProgresoUsuarioLeccion', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  leccion_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  completado: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  fecha_completado: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'progreso_usuario_lecciones',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['usuario_id', 'leccion_id'],
    },
  ],
});

module.exports = ProgresoUsuarioLeccion;
