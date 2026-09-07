const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { encrypt, decrypt } = require('../utils/encryption');

/**
 * Parámetros de configuración del sistema, editables sin redeploy.
 *
 * Nace para las credenciales de PagoPar con las que Gesicomm cobra sus
 * suscripciones: estaban pensadas para el .env, pero eso obliga a tocar el
 * servidor y reiniciar cada vez que se rotan. Acá se cambian desde el panel.
 *
 * No confundir con `payment_gateways`: esa tabla guarda las credenciales de
 * CADA COMERCIO para cobrarle a sus propios clientes. Esto es del sistema.
 *
 * Los valores marcados como `secreto` se cifran con AES-256-GCM igual que
 * PaymentGateway.private_key, y nunca se devuelven en texto plano por la API
 * — solo un booleano de "está configurado".
 */
const Parametro = sequelize.define('Parametro', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  clave: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
  },
  valor: {
    type: DataTypes.TEXT,
    allowNull: true,
    // El cifrado se decide por el flag `secreto` de la propia fila. Como el
    // setter no puede leer otro campo de forma confiable durante la
    // hidratación, se marca con un prefijo el contenido cifrado.
    set(val) {
      if (val === null || val === undefined || val === '') {
        this.setDataValue('valor', null);
        return;
      }
      if (this.getDataValue('secreto') || this.dataValues.secreto) {
        this.setDataValue('valor', `enc:${encrypt(String(val))}`);
      } else {
        this.setDataValue('valor', String(val));
      }
    },
    get() {
      const val = this.getDataValue('valor');
      if (!val) return val;
      if (!String(val).startsWith('enc:')) return val;
      try {
        return decrypt(String(val).slice(4));
      } catch (error) {
        console.error(`[Parametro] No se pudo descifrar "${this.getDataValue('clave')}":`, error.message);
        return null;
      }
    },
  },
  secreto: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'true = se cifra en la base y nunca se expone por la API.',
  },
  grupo: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'general',
    comment: 'Para agrupar en el panel (ej: "pagopar").',
  },
  descripcion: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
}, {
  tableName: 'parametros',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Parametro;
