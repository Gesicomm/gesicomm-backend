const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Historial simple de movimientos de un pedido — ver plan Gestión de
 * Pedidos sección 24. No se muestra permanentemente en la tabla, se
 * consulta dentro del detalle del pedido. `detalle` es texto ya formateado
 * para mostrar directamente (ej. "Pendiente → Confirmado", "Método de
 * pago: Efectivo", "Incluido en rendición #R-0021") — no hace falta un
 * catálogo rígido de tipos de evento para un log de auditoría simple.
 */
const EnvioHistorial = sequelize.define('EnvioHistorial', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  envio_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  detalle: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Null cuando el evento lo generó el sistema automáticamente (ej. checkout público).',
  },
}, {
  tableName: 'envio_historial',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['envio_id'] },
  ],
});

module.exports = EnvioHistorial;
