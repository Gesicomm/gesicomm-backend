const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Un pedido (Envio) que cuenta como lead de una campaña interna, resuelto
 * automáticamente al crearse el pedido: si alguno de sus productos está en
 * `MetaCampanaInterna.producto_ids` de una campaña activa del mismo tipo
 * (web/whatsapp según el origen del pedido — ver esOrigenWhatsapp), se
 * registra acá. Nunca lo elige el usuario a mano.
 *
 * Un pedido con productos de varias campañas activas genera una fila por
 * cada una (cuenta como lead en todas), no solo en la primera que matchea.
 */
const MetaCampanaLead = sequelize.define('MetaCampanaLead', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  meta_campana_interna_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  envio_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Qué producto del pedido matcheó contra producto_ids de la campaña.',
  },
}, {
  tableName: 'meta_campana_leads',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['meta_campana_interna_id', 'envio_id', 'producto_id'], unique: true },
    { fields: ['envio_id'] },
  ],
});

module.exports = MetaCampanaLead;
