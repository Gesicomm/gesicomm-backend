const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DeliveryZonaTarifa = sequelize.define('DeliveryZonaTarifa', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  courier_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  departamento: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  ciudad: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  tipo_pago: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'Ambos',
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
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'delivery_zona_tarifas',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = DeliveryZonaTarifa;
