const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DeliveryZonaTarifa = sequelize.define('DeliveryZonaTarifa', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  // Una regla es del comercio (usuario + courier) o de la red (proveedor +
  // centro). Nunca mezcla y nunca ninguna de las dos: lo garantiza el CHECK
  // `delivery_zona_tarifas_dueno_check`, no la aplicación.
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  courier_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  proveedor_logistico_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  // El centro forma parte de la identidad de una tarifa de red: el mismo
  // proveedor puede cobrar distinto a la misma ciudad según desde dónde sale.
  centro_id: {
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
  // --- Cobertura contra el catálogo geográfico ---
  tipo_cobertura: {
    type: DataTypes.STRING(20),
    allowNull: true,
    validate: { isIn: [['CIUDAD', 'RESTO_DEPARTAMENTO', 'RESTO_PAIS']] },
    comment: 'NULL = cobertura legacy por texto, pendiente de clasificar. Sigue resolviéndose por nombre.',
  },
  ciudad_id: { type: DataTypes.INTEGER, allowNull: true },
  departamento_id: { type: DataTypes.INTEGER, allowNull: true },
  pais_id: { type: DataTypes.INTEGER, allowNull: true },
  tiempo_entrega_min_hs: { type: DataTypes.INTEGER, allowNull: true },
  tiempo_entrega_max_hs: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'delivery_zona_tarifas',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = DeliveryZonaTarifa;
