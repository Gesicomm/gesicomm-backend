const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Courier = sequelize.define('Courier', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  tienda_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Tienda dueña del courier. Nullable: couriers GESICOMM (no son de ninguna tienda) y filas viejas de antes de esta columna.',
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  telefono: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  vehiculo: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
  },
  alcance: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'PROPIO',
    validate: { isIn: [['GESICOMM', 'PROPIO']] },
    comment: 'PROPIO = courier privado del comercio. GESICOMM = proveedor logístico ofrecido por Gesicomm, configurado por el admin y utilizable por los comercios.',
  },
}, {
  tableName: 'couriers',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Courier;
