const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * API Key de un sistema externo (ERP/e-commerce de un comercio) que empuja
 * su catálogo de productos a Gesicomm. Cada credencial pertenece a UNA
 * Tienda: todo lo que entre con esta key se escribe en el catálogo de esa
 * tienda, nunca en otra. No hay cuenta/login propio del sistema externo —
 * es la API Key la única identidad.
 *
 * Igual que el resto de secretos del sistema, nunca se guarda en texto
 * plano: `api_key_hash` es el SHA-256 de la key. El texto completo solo se
 * muestra una vez, en el momento de crearla (ver integracionProductos.service.js).
 */
const IntegracionCredencial = sequelize.define('IntegracionCredencial', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  tienda_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Tienda dueña del catálogo que esta credencial puede escribir.',
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Dueño de la Tienda al momento de crear la credencial. Denormalizado para pasarlo a ProductoService (crear/actualizar lo exige para atribuir creado_por y chequear pertenencia), sin tener que resolver Tienda en cada request.',
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
    comment: 'Nombre descriptivo elegido por el comercio, ej: "ERP propio", "Shopify".',
  },
  codigo: {
    type: DataTypes.STRING(40),
    allowNull: false,
    comment: 'Slug único global. Se usa como prefijo de SKU si el SKU externo choca con otro producto.',
  },
  api_key_hash: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: 'SHA-256 (hex) de la API Key real. La key en texto plano nunca se persiste.',
  },
  api_key_prefix: {
    type: DataTypes.STRING(16),
    allowNull: false,
    comment: 'Primeros caracteres de la key, solo para que el comercio la identifique en la lista.',
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
    comment: 'false = revocada. Nunca se borra físicamente (auditoría de integraciones).',
  },
  ultima_actividad_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  creado_por: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'FK a Usuario que generó la credencial.',
  },
}, {
  tableName: 'integracion_credenciales',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['api_key_hash'] },
    { unique: true, fields: ['codigo'] },
    { fields: ['tienda_id'] },
  ],
});

module.exports = IntegracionCredencial;
