const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const MetodoPago = sequelize.define('MetodoPago', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  nombre: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  comision_porcentaje: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0,
  },
  es_anticipado: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Determina si este método de pago cuenta como "Anticipado" al buscar la tarifa de courier configurada por tipo de pago.',
  },
  custodia_cobro: {
    type: DataTypes.ENUM('negocio', 'courier'),
    allowNull: false,
    defaultValue: 'negocio',
    comment: 'Quién tiene físicamente el dinero cobrado con este método: "courier" (efectivo, transferencia a su cuenta — debe rendir monto-costo_envio) o "negocio" (transferencia a la cuenta de la empresa, POS — la tienda le debe el costo_envio al courier). Reemplaza comparaciones de texto hardcodeadas en el motor de rendición.',
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
  },
  orden: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: false,
  },
}, {
  tableName: 'metodos_pago',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = MetodoPago;
