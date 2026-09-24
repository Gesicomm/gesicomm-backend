const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Snapshot inmutable de qué se descontó realmente del stock al confirmar un
 * EnvioItem. Se escribe UNA sola vez, en el momento de la confirmación
 * (cuando de verdad se descuenta stock) — tanto para ítems de producto
 * simple (1 fila) como para ítems vendidos con una Oferta (1 fila por
 * componente de la receta, con la cantidad ya multiplicada).
 *
 * Existe para que un pedido confirmado nunca cambie de significado si
 * después se edita o se da de baja la Oferta que se usó para venderlo —
 * la reportería de costos siempre lee de acá, nunca recalcula en vivo
 * contra Oferta/OfertaComponente.
 */
const EnvioItemComponente = sequelize.define('EnvioItemComponente', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  envio_item_id: {
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
    comment: 'Variante puntual de la que realmente se descontó stock (null = producto sin variante). Snapshot inmutable, igual que el resto de esta tabla.',
  },
  cantidad: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    comment: 'Unidades físicas realmente descontadas de este producto (item.cantidad × componente.cantidad).',
  },
  costo_unitario: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0,
    comment: 'Snapshot de Producto.precio_costo al momento de confirmar.',
  },
  // --- Devoluciones y pérdidas parciales, por producto ---
  // cantidad_devuelta_vendible + cantidad_devuelta_danada + cantidad_perdida
  // nunca puede superar `cantidad` (se valida en envioController).
  cantidad_devuelta_vendible: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  cantidad_devuelta_danada: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  cantidad_perdida: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  // --- Origen fisico cuando el stock salio de un Centro Gesicomm ---
  origen_centro_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'FK a depositos.id (alcance GESICOMM). NULL = salio del stock propio del comercio (salon/deposito).',
  },
  cantidad_desde_centro: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Cuanto de cantidad salio de origen_centro_id. NULL cuando origen_centro_id es NULL. Gatilla la cola de preparacion de Gesicomm.',
  },
}, {
  tableName: 'envio_item_componentes',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['envio_item_id'] },
    { fields: ['producto_id'] },
  ],
});

module.exports = EnvioItemComponente;
