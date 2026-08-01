const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PreguntaExamen = sequelize.define('PreguntaExamen', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  examen_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  pregunta: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  tipo: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'opcion_multiple',
  },
  opciones: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: 'Array de opciones JSON: [{ id: 1, texto: "..." }]',
  },
  respuesta_correcta: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Identificador o texto de la opción correcta',
  },
  explicacion: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Feedback explicativo mostrado al calificar el examen',
  },
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
}, {
  tableName: 'preguntas_examen',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = PreguntaExamen;
