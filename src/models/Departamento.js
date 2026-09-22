const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Departamento = sequelize.define('Departamento', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  pais_id: { type: DataTypes.INTEGER, allowNull: false },
  nombre: { type: DataTypes.STRING(100), allowNull: false },
  nombre_normalizado: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Sin acentos, minúsculas. Misma normalización que TarifaDeliveryService.normalizarTexto.',
  },
  activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName: 'departamentos', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at',
});

module.exports = Departamento;
