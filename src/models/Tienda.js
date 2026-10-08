const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Tienda de un usuario (rol 'usuario'): 1:N con Usuario — un usuario puede
 * tener varias tiendas, cada tienda tiene un único dueño. Es el contenedor
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
  // --- Identificacion fiscal del comercio ---
  // PagoPar pide DOS campos distintos y simultaneos, no uno u otro:
  //   documento        -> la cedula. Obligatorio, y `tipo_documento` va
  //                       siempre con el literal "CI" (lo dice la doc:
  //                       "siempre debe enviarse el valor 'CI'").
  //   ruc              -> identificacion fiscal. Opcional; si no tiene, se
  //                       manda cadena vacia.
  // Se guardan nullable porque las tiendas que ya existian no los tienen; el
  // onboarding los exige de aca en adelante.
  documento: {
    type: DataTypes.STRING(30),
    allowNull: true,
    comment: 'Cedula del titular. Va como comprador.documento en PagoPar (tipo_documento siempre "CI").',
  },
  ruc: {
    type: DataTypes.STRING(30),
    allowNull: true,
    comment: 'RUC del comercio. Opcional: PagoPar lo acepta vacio si no tiene.',
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
  typography: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {},
    comment: 'Configuración tipográfica global de la tienda: heading/body y referencias a fuentes propias.',
  },
  // --- Logo: default de todas las landings de la tienda. Una landing con
  // logo propio (Landing.logo_imagen o el del bloque Header) lo pisa. Solo
  // lo escriben los endpoints de subida, nunca el PUT de texto. ---
  logo_imagen: {
    type: DataTypes.STRING(700),
    allowNull: true,
    comment: 'URL pública del logo (CDN de R2).',
  },
  logo_imagen_storage_key: { type: DataTypes.STRING(700), allowNull: true },
  logo_imagen_mime_type: { type: DataTypes.STRING(100), allowNull: true },
  logo_imagen_size: { type: DataTypes.INTEGER, allowNull: true },
  logo_imagen_width: { type: DataTypes.INTEGER, allowNull: true },
  logo_imagen_height: { type: DataTypes.INTEGER, allowNull: true },
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
  // Email y redes: se cargan en el onboarding / Configurar tienda y son el
  // default del contacto de todas las landings (landing.contacto_* los pisa).
  email: { type: DataTypes.STRING(150), allowNull: true },
  instagram: { type: DataTypes.STRING(100), allowNull: true },
  facebook: { type: DataTypes.STRING(100), allowNull: true },
  tiktok: { type: DataTypes.STRING(100), allowNull: true },
  youtube: { type: DataTypes.STRING(100), allowNull: true },
  twitter: { type: DataTypes.STRING(100), allowNull: true },
  // Contacto público ampliado (Configurar tienda → Contacto).
  nombre_contacto: { type: DataTypes.STRING(100), allowNull: true },
  canal_contacto: { type: DataTypes.STRING(20), allowNull: true, comment: 'whatsapp | email | telefono | instagram' },
  direccion_publica: { type: DataTypes.STRING(255), allowNull: true, comment: 'La que se muestra al público, no la del depósito.' },
  ciudad_publica: { type: DataTypes.STRING(100), allowNull: true },
  mensaje_contacto: {
    type: DataTypes.STRING(300),
    allowNull: true,
    comment: 'Plantilla de mensaje de WhatsApp. Soporta el placeholder {producto}.',
  },
  nombre_contacto: {
    type: DataTypes.STRING(150),
    allowNull: true,
    comment: 'Nombre visible al público en la sección de contacto.',
  },
  canal_contacto: {
    type: DataTypes.STRING(30),
    allowNull: true,
    defaultValue: 'whatsapp',
    comment: 'Canal preferido de contacto: whatsapp, email, telefono, instagram.',
  },
  email_contacto: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
  instagram: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Handle de Instagram sin @.',
  },
  facebook: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: 'Handle o URL de página de Facebook.',
  },
  twitter: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Handle de Twitter/X sin @.',
  },
  tiktok: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Handle de TikTok sin @.',
  },
  youtube: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: 'URL del canal de YouTube.',
  },
  direccion_publica: {
    type: DataTypes.STRING(300),
    allowNull: true,
    comment: 'Dirección física visible al público (distinta de deposito_direccion).',
  },
  ciudad_publica: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Ciudad o localidad visible al público.',
  },
  horario_atencion: {
    type: DataTypes.STRING(150),
    allowNull: true,
    comment: 'Texto libre, ej: Lunes a viernes de 9 a 18 horas.',
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
  // --- Dirección de depósito: adónde el administrador le envía la
  // mercadería que este usuario vendió (no es la dirección del cliente
  // final, esa vive en Envio). Nullable: se completa desde Mi Tienda. ---
  deposito_departamento: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  deposito_ciudad: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  deposito_direccion: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  deposito_referencia: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  deposito_telefono: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  // --- Fulfillment: cuando este comercio vende, ¿quién prepara y entrega?
  // Es una decisión distinta de Envio.tipo_logistica_abastecimiento, que
  // define dónde se RECIBE el stock comprado. ---
  modalidad_fulfillment: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'PROPIA',
    validate: { isIn: [['GESICOMM', 'PROPIA']] },
  },
  deposito_fulfillment_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Depósito desde el que se despacha con modalidad PROPIA.',
  },
}, {
  tableName: 'tiendas',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['usuario_id'] },
    { unique: true, fields: ['subdominio'] },
    { unique: true, fields: ['dominio_propio'] },
    { fields: ['inquilino_id'] },
  ],
});

module.exports = Tienda;
