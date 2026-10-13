'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { encrypt, decrypt } = require('../utils/encryption');
module.exports = sequelize.define('SpeedboxTienda', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  usuario_id: { type: DataTypes.INTEGER, allowNull: false },
  environment: { type: DataTypes.STRING(20), allowNull: false },
  tienda_id: { type: DataTypes.STRING(100), allowNull: true },
  public_key: { type: DataTypes.STRING(255), allowNull: true },
  private_key: {
    type: DataTypes.TEXT,
    allowNull: true,
    set(val) {
      if (val) this.setDataValue('private_key', encrypt(val));
      else this.setDataValue('private_key', null);
    },
    get() {
      const val = this.getDataValue('private_key');
      if (!val) return val;
      try { return decrypt(val); }
      catch (error) {
        console.error('[SpeedboxTienda] Error al descifrar private_key:', error.message);
        return null;
      }
    },
  },
  courier_id: { type: DataTypes.INTEGER, allowNull: true },
  activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  enabled_at: { type: DataTypes.DATE, allowNull: true },
  since_at: { type: DataTypes.STRING(50), allowNull: true },
  spec_verified_at: { type: DataTypes.DATE, allowNull: true },
  order_verified_at: { type: DataTypes.DATE, allowNull: true },
  updates_verified_at: { type: DataTypes.DATE, allowNull: true },
  webhook_verified_at: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'speedbox_tiendas', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at',
  indexes: [{ unique: true, fields: ['usuario_id', 'environment'] }, { unique: true, fields: ['environment', 'tienda_id'] }] });
