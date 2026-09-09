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
 * - dominio_propio: el hostname que el cliente apuntó a nuestra IP con un
 *   registro A. Se verifica resolviendo su DNS (src/utils/dominios.js) y el
 *   certificado lo emite Caddy solo.
 * - dominio_propio_habilitado: lo único del ciclo de vida del dominio que
 *   se guarda. Los estados pendiente/verificado/activo se calculan contra
 *   el DNS real en cada consulta, porque el cliente puede cambiar su DNS
 *   cuando quiera y un valor guardado quedaría mintiendo.
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
  dominio_propio_habilitado: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: 'false = el dominio queda cargado pero no se sirve ni se le emite certificado.',
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
  // --- Analítica de terceros: solo el lado cliente (pixel/gtag). A
  // diferencia de Meta, no hay integración server-side (CAPI) para
  // estas — no hay token que cifrar ni endpoint que llamar. ---
  google_analytics_id: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: 'Measurement ID de GA4, formato "G-XXXXXXXXXX".',
  },
  tiktok_pixel_id: {
    type: DataTypes.STRING(30),
    allowNull: true,
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
