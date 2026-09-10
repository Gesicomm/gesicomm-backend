const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AfiliadoComision = sequelize.define('AfiliadoComision', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  afiliado_id: { type: DataTypes.INTEGER, allowNull: false },
  suscripcion_id: { type: DataTypes.INTEGER, allowNull: false },
  pago_suscripcion_id: { type: DataTypes.INTEGER, allowNull: true },
  monto_base: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  comision_pct: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 40 },
  monto_comision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  estado: {
    type: DataTypes.ENUM('pendiente', 'aprobada', 'pagada', 'anulada'),
    allowNull: false,
    defaultValue: 'pendiente',
  },
  notas: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'afiliado_comisiones',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['afiliado_id'] },
    { fields: ['suscripcion_id'] },
    { fields: ['estado'] },
    { unique: true, fields: ['pago_suscripcion_id'] },
  ],
});

module.exports = AfiliadoComision;
