const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const HistorialSolicitudAbastecimiento = sequelize.define('HistorialSolicitudAbastecimiento', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  solicitud_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  estado: {
    type: DataTypes.STRING(40),
    allowNull: false,
  },
  comentario: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
}, {
  tableName: 'historial_solicitudes_abastecimiento',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = HistorialSolicitudAbastecimiento;
