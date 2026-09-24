const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Camino 3: el comercio pide traer stock de un producto del catalogo
 * Gesicomm hacia su deposito propio o hacia un Centro de Fulfillment de
 * Gesicomm, sin que exista todavia ninguna venta. Entidad propia, separada
 * de Envio a proposito (ver comentario de la migracion que la crea).
 */
const SolicitudAbastecimiento = sequelize.define('SolicitudAbastecimiento', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  variante_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  cantidad: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  tipo_logistica: {
    type: DataTypes.STRING(20),
    allowNull: false,
    validate: { isIn: [['GESICOMM', 'PROPIA']] },
  },
  deposito_destino_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  centro_gesicomm_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  costo_producto: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  costo_logistico: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  estado: {
    type: DataTypes.STRING(40),
    allowNull: false,
    defaultValue: 'pendiente_pago',
  },
  comprobante_url: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  comprobante_storage_key: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  rechazo_motivo: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
}, {
  tableName: 'solicitudes_abastecimiento',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = SolicitudAbastecimiento;
