const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CourierTarifa = sequelize.define('CourierTarifa', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  courier_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  ciudad_zona: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  tipo_pago: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  rango_min: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  rango_max: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  costo: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  tiempo_entrega_hs: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
}, {
  tableName: 'courier_tarifas',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = CourierTarifa;
