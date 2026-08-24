const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const EnvioItem = sequelize.define('EnvioItem', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  envio_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  oferta_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Oferta elegida al vender este ítem, si la hubo. La receta real usada se snapshotea en EnvioItemComponente al confirmar.',
  },
  oferta_codigo: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Snapshot de Oferta.codigo al momento de la venta — no se recalcula si la oferta cambia después.',
  },
  oferta_nombre: {
    type: DataTypes.STRING(150),
    allowNull: true,
    comment: 'Snapshot de Oferta.nombre al momento de la venta.',
  },
  nombre_producto: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  cantidad: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  origen_venta: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'normal',
    comment: 'Canal por el que se vendió esta línea: normal | order_bump | upsell | combo. Snapshot, no se recalcula uniendo contra la oferta (que puede editarse o darse de baja después).',
  },
  precio_unitario: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  precio_normal: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Precio unitario que habría tenido esta línea por el canal normal. Contra precio_unitario da el descuento concedido por el order bump.',
  },
  subtotal: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'envio_items',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = EnvioItem;
