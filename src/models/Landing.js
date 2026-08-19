const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Landing pública de una Tienda: una selección curada de productos/combos
 * de la vitrina del dueño, publicada sin autenticación.
 *
 * - El tema (colores), el contacto (whatsapp/mensaje) y el pixel de Meta
 *   viven en Tienda, no acá — son compartidos por defecto entre todas las
 *   landings de una tienda. Override por landing queda para más adelante.
 * - slug es único POR TIENDA (no global): la URL pública depende del
 *   hostname (subdominio o dominio propio de la tienda), resuelto por
 *   middleware/resolverTienda.js antes de llegar acá. Se sigue generando
 *   con sufijo aleatorio, no secuencial, para no volver los slugs
 *   enumerables dentro de una misma tienda.
 * - es_home: si true, esta landing es la raíz del subdominio/dominio
 *   (GET /api/l/ sin slug). Única por tienda — lo valida el service.
 * - activo=false (default) = borrador, no visible públicamente.
 */
const Landing = sequelize.define('Landing', {
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
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
    comment: 'Nombre interno, no necesariamente el título público.',
  },
  slug: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: 'Único por tienda. La tienda resuelve el hostname, esto resuelve el path.',
  },
  titulo: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
  descripcion: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  es_home: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Landing raíz de la tienda (GET /api/l/ sin slug). Única por tienda.',
  },
  tipo_pagina: {
    type: DataTypes.ENUM('inicio', 'catalogo', 'contacto', 'funnel'),
    allowNull: true,
    defaultValue: 'funnel',
  },
  template_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  template_version: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  content: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  // --- Filtros visibles en la landing pública ---
  mostrar_filtro_categoria: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  mostrar_filtro_marca: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  mostrar_filtro_etiqueta: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  mostrar_buscador: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  mostrar_orden_precio: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  // --- Banner principal: a diferencia del tema/contacto, es contenido
  // propio de ESTA landing, no compartido con las demás de la tienda. ---
  mostrar_banner: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  banner_imagen: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Ruta relativa servida por /uploads, misma convención que ProductoImagen.url.',
  },
  banner_titulo: { type: DataTypes.STRING(200), allowNull: true },
  banner_subtitulo: { type: DataTypes.STRING(300), allowNull: true },
  banner_boton_texto: { type: DataTypes.STRING(50), allowNull: true },
  banner_boton_link: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Validado en el service: solo http(s):// o ruta relativa — se renderiza como href en la landing pública.',
  },
  banner_opacidad: { type: DataTypes.INTEGER, allowNull: true, comment: 'Opacidad de la imagen de fondo (0-100)' },
  // --- Identidad y contacto propios de los templates rígidos (Fitness/
  // Beauty/Tech) — ver landingSimple.service.js. Independientes de Tienda
  // (whatsapp/telefono ahí son compartidos entre landings; esto no). ---
  logo_imagen: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Ruta relativa servida por /uploads. Solo la escribe el endpoint de subida (landingSimple), nunca el PUT de texto — mismo criterio que banner_imagen.',
  },
  contacto_whatsapp: { type: DataTypes.STRING(50), allowNull: true },
  contacto_telefono: { type: DataTypes.STRING(50), allowNull: true },
  contacto_email: { type: DataTypes.STRING(150), allowNull: true },
  contacto_direccion: { type: DataTypes.STRING(255), allowNull: true },
  contacto_instagram: { type: DataTypes.STRING(100), allowNull: true },
  contacto_facebook: { type: DataTypes.STRING(100), allowNull: true },
  contacto_tiktok: { type: DataTypes.STRING(100), allowNull: true },
  contacto_youtube: { type: DataTypes.STRING(100), allowNull: true },
  contacto_twitter: { type: DataTypes.STRING(100), allowNull: true },
  // Sección "Contenido adicional" (título + párrafo libre, antes de
  // Contacto) — null = el template usa su propio copy por defecto.
  contenido_titulo: { type: DataTypes.STRING(150), allowNull: true },
  contenido_texto: { type: DataTypes.TEXT, allowNull: true },
  productos_titulo: { type: DataTypes.STRING(150), allowNull: true, comment: 'Título para la sección de productos destacados' },
  // --- Diseño: override por landing. null en color_primario/color_fondo
  // = hereda el de Tienda (comportamiento de siempre). ---
  tema_modo: { type: DataTypes.ENUM('oscuro', 'claro'), allowNull: false, defaultValue: 'oscuro' },
  color_primario: { type: DataTypes.STRING(7), allowNull: true },
  color_fondo: { type: DataTypes.STRING(7), allowNull: true },
  color_texto: { type: DataTypes.STRING(7), allowNull: true, comment: 'Override del color de letras; null = hereda el default de tema_modo.' },
  color_tarjeta: { type: DataTypes.STRING(7), allowNull: true, comment: 'Override del fondo de las tarjetas de producto; null = hereda el default de tema_modo.' },
  radio_bordes: { type: DataTypes.ENUM('chico', 'mediano', 'grande'), allowNull: false, defaultValue: 'mediano' },
  fuente: { type: DataTypes.ENUM('outfit', 'inter', 'poppins', 'roboto'), allowNull: false, defaultValue: 'outfit' },
  mostrar_whatsapp: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  // --- Opiniones y FAQ: contenido propio de ESTA landing, igual criterio
  // que el banner (ver Testimonio.js/Faq.js) ---
  mostrar_testimonios: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  mostrar_faq: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // Default true: hoy el ÚNICO comportamiento que existe al finalizar un
  // pedido es redirigir a WhatsApp — con el toggle apagado, el checkout
  // solo crea el pedido (Envio) y muestra una confirmación en la página.
  checkout_redirigir_whatsapp: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  // --- SEO ---
  seo_titulo: { type: DataTypes.STRING(160), allowNull: true },
  seo_descripcion: { type: DataTypes.STRING(320), allowNull: true },
  seo_keywords: { type: DataTypes.STRING(300), allowNull: true },
  seo_og_imagen: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Igual que banner_imagen: solo la escribe el endpoint de subida, no el PUT de texto.',
  },
  // --- Mensaje de WhatsApp: qué agregar además de {producto} ---
  whatsapp_incluir_precio: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  whatsapp_incluir_url: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'false = borrador, no visible públicamente.',
  },
}, {
  tableName: 'landings',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['tienda_id', 'slug'] },
    { fields: ['tienda_id'] },
    { fields: ['inquilino_id'] },
  ],
});

module.exports = Landing;
