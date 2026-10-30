const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * API Key de un sistema externo que empuja su catálogo de productos a
 * Gesicomm. No hay cuenta ni login propio del sistema externo: la API Key
 * es la única identidad. Hay dos tipos, y la diferencia es a qué catálogo
 * escribe cada uno:
 *
 * - **Proveedor** (`proveedor_id`, sin tienda): el caso principal. Es la
 *   key que se le pasa a un proveedor que quiere vender a través de
 *   Gesicomm. Lo que manda entra al catálogo GLOBAL: lo ve todo comercio en
 *   Mi catálogo y lo puede usar en sus landings y páginas de venta, igual
 *   que los productos cargados por el administrador. Cada producto queda
 *   atado a su Proveedor, que es lo que permite filtrarlos por proveedor y
 *   mostrar su logo en la tarjeta.
 * - **Tienda** (`tienda_id` + `usuario_id`, sin proveedor): el ERP propio
 *   de un comercio sincronizando SU catálogo. Lo que entra con esa key es
 *   de esa tienda y de nadie más.
 *
 * Nunca las dos cosas a la vez: `proveedor_id` manda.
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
  proveedor_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Proveedor dueño de los productos. Si está, la credencial escribe en el catálogo global (sin tienda ni usuario) y cada producto queda con este proveedor_id.',
  },
  tienda_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Solo en credenciales de tienda: el catálogo del comercio que esta credencial puede escribir. null en las de proveedor.',
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Solo en credenciales de tienda: el dueño de la Tienda al crearla. Denormalizado para pasarlo a ProductoService (crear/actualizar lo exige para atribuir creado_por y chequear pertenencia), sin resolver Tienda en cada request. null en las de proveedor: esos productos no tienen dueño, como los del administrador.',
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
