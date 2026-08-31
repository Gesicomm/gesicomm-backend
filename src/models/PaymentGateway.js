const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { encrypt, decrypt } = require('../utils/encryption');

const PaymentGateway = sequelize.define('PaymentGateway', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  provider: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  public_key: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  private_key: {
    type: DataTypes.TEXT,
    allowNull: true,
    set(val) {
      if (val) {
        this.setDataValue('private_key', encrypt(val));
      } else {
        this.setDataValue('private_key', null);
      }
    },
    get() {
      const val = this.getDataValue('private_key');
      if (val) {
        try {
          return decrypt(val);
        } catch (error) {
          console.error('[PaymentGateway] Error al descifrar private_key:', error.message);
          return null;
        }
      }
      return val;
    }
  },
  environment: {
    type: DataTypes.ENUM('sandbox', 'production'),
    allowNull: false,
    defaultValue: 'sandbox',
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'payment_gateways',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = PaymentGateway;
