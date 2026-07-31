const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Tienda de un usuario (rol 'usuario'): 1:1 con Usuario. Es el contenedor
 * de sus landings públicas y el dueño de la identidad pública (subdominio
 * gesicomm.com, opcionalmente un dominio propio) y del tema/contacto/pixel
 * que antes vivían sueltos en cada Landing.
 *
 * - subdominio: único global, inmutable una vez creada la tienda (lo
 *   impone el service, no la DB — permitir cambiarlo más adelante implica
 *   decidir qué pasa con el subdominio viejo, ver "Lo que no va en v1").
 * - dominio_propio_cf_hostname_id: el ID que devuelve Cloudflare for SaaS
 *   al crear el Custom Hostname — necesario para consultar estado o revocar.
 */
const Tienda = sequelize.define('Tienda', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  subdominio: {
    type: DataTypes.STRING(63),
    allowNull: false,
    comment: 'Único global. URL pública: https://<subdominio>.gesicomm.com',
  },
  dominio_propio: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  dominio_propio_verificado: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  dominio_propio_cf_hostname_id: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  // --- Tema (default para todas las landings de la tienda) ---
  color_primario: {
    type: DataTypes.STRING(7),
    allowNull: true,
    defaultValue: '#10b981',
  },
  color_secundario: {
    type: DataTypes.STRING(7),
    allowNull: true,
    defaultValue: '#059669',
  },
  color_fondo: {
    type: DataTypes.STRING(7),
    allowNull: true,
    defaultValue: '#0a0a0a',
  },
  // --- Contacto base ---
  whatsapp: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: 'Solo dígitos con código de país, ej: 595981234567.',
  },
  telefono: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  mensaje_contacto: {
    type: DataTypes.STRING(300),
    allowNull: true,
    comment: 'Plantilla de mensaje de WhatsApp. Soporta el placeholder {producto}.',
  },
  // --- Reservado: Meta Pixel / CAPI, sin uso todavía ---
  meta_pixel_id: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  meta_access_token: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Cifrado con EncryptionService (AES-256-GCM). Nunca se expone en el GET público.',
  },
  meta_test_event_code: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  meta_capi_activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'tiendas',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['usuario_id'] },
    { unique: true, fields: ['subdominio'] },
    { unique: true, fields: ['dominio_propio'] },
    { fields: ['inquilino_id'] },
  ],
});

module.exports = Tienda;
