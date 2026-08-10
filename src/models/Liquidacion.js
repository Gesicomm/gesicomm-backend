const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Registro permanente de una rendición por lote con un courier — el
 * resultado de "previsualizar" + "confirmar" en liquidacion.service.js.
 * Una vez creada, los Envio incluidos (ver LiquidacionEnvio) pasan a
 * estado_financiero='liquidado' y no vuelven a aparecer en una
 * previsualización futura.
 */
const Liquidacion = sequelize.define('Liquidacion', {
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
    allowNull: false,
  },
  fecha_desde: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  fecha_hasta: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  total_dinero_courier: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Efectivo + transferencias a cuenta del courier, de los pedidos incluidos (custodia_cobro=courier).',
  },
  total_costo_servicios: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Suma de costo_envio de los pedidos incluidos — el courier siempre cobra esto, sin importar quién tenga el dinero.',
  },
  total_cargos_perdida: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  ajuste_manual: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  saldo_final: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'total_dinero_courier + total_cargos_perdida - total_costo_servicios + ajuste_manual. Positivo = el courier transfiere a la tienda; negativo = la tienda le paga al courier.',
  },
  observacion: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  usuario_registro_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Quién confirmó la liquidación.',
  },
}, {
  tableName: 'liquidaciones',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['usuario_id'] },
    { fields: ['courier_id'] },
  ],
});

module.exports = Liquidacion;
