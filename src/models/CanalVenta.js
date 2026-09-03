const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Canal de venta por el que entró un pedido (Web, Orgánico, WhatsApp...).
 *
 * Antes esto era `Envio.origen`, un STRING(50) de texto libre con las
 * opciones hardcodeadas en el frontend: cada pantalla armaba su propia
 * lista y cualquier typo creaba un canal fantasma en los reportes. Acá el
 * catálogo vive en la base, así que agregar un canal es cargar una fila y
 * no tocar código.
 *
 * Mismo contrato multi-tenant que CategoriaCostoGasto: inquilino_id NULL =
 * canal global del sistema (ver canalVenta.service.js#seedDefaults),
 * inquilino_id con valor = canal propio de ese tenant.
 *
 * `Envio.origen` se mantiene como snapshot histórico del valor viejo — no
 * se borra para no perder la trazabilidad de los pedidos que ya existían.
 */
const CanalVenta = sequelize.define('CanalVenta', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  nombre: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  slug: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  // Orden de aparición en los selectores y en los reportes. Se define a
  // mano para que "Web" no quede debajo de "WhatsApp" solo por alfabético.
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'canales_venta',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = CanalVenta;
