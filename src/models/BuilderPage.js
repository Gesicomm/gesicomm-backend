const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Página del Page Builder. El HTML/CSS/JS NO vive acá: vive en
 * BuilderPageVersion. Esta fila es la identidad estable de la página
 * (nombre, slug, SEO) más los dos punteros que separan lo que se edita de
 * lo que ve el visitante:
 *
 *   draft_version_id      → la versión que edita el comercio
 *   published_version_id  → la ÚNICA que sirve la ruta pública
 *
 * Guardar crea una versión nueva y mueve draft_version_id. Publicar es lo
 * único que mueve published_version_id. Nunca se sobrescribe una versión
 * publicada — ese es el punto entero del módulo.
 *
 * Suelta vs. de funnel — lo decide `funnel_id`:
 *   funnel_id = NULL  → página suelta,    /p/<slug>           slug único GLOBAL
 *   funnel_id = X     → página de funnel, /f/<funnel>/<slug>  slug único por FUNNEL
 *
 * Los dos ámbitos de unicidad son dos índices PARCIALES en la base (ver la
 * migración): así dos funnels distintos pueden tener cada uno su página
 * "landing" sin pisarse, y a la vez /p/<slug> no se puede duplicar.
 *
 * ⚠️ Sin tienda_id: una página del builder no pertenece a ninguna tienda.
 * El dueño es usuario_id. Ver la cabecera de BuilderProject.js.
 *
 * ⚠️ Esta tabla NO tiene `posicion` ni `es_entrada` a propósito. El orden
 * dentro del funnel y cuál es la página de entrada viven SOLO en
 * BuilderFunnelPage. `funnel_id` acá existe únicamente para poder tener
 * los índices parciales de slug; que no se desincronice del de la tabla
 * puente lo garantiza una FK compuesta, no el código.
 */
const BuilderPage = sequelize.define('BuilderPage', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  proyecto_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  funnel_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'NULL = página suelta (/p/<slug>). Ver la cabecera: no es el orden, es el ámbito del slug.',
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'El dueño. Filtro de toda consulta del módulo.',
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
    comment: 'Nombre interno, no necesariamente el título público.',
  },
  slug: {
    type: DataTypes.STRING(120),
    allowNull: false,
    validate: { is: /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/ },
  },
  estado: {
    type: DataTypes.STRING(15),
    allowNull: false,
    defaultValue: 'draft',
    validate: { isIn: [['draft', 'published', 'unpublished']] },
    comment: 'draft = nunca se publicó · published = published_version_id no es null · unpublished = se publicó alguna vez y se bajó.',
  },
  // --- SEO / Open Graph ---
  seo_titulo: {
    type: DataTypes.STRING(160),
    allowNull: true,
  },
  seo_descripcion: {
    type: DataTypes.STRING(320),
    allowNull: true,
  },
  og_titulo: {
    type: DataTypes.STRING(160),
    allowNull: true,
    comment: 'Si es null, el renderer público cae a seo_titulo. Ver builderPublicPage.service.js.',
  },
  og_descripcion: {
    type: DataTypes.STRING(320),
    allowNull: true,
  },
  og_imagen: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Ruta relativa servida por /uploads. Solo la escribe el endpoint de subida, nunca el PUT de texto — mismo criterio que Landing.banner_imagen (si no, se podría apuntar el OG a cualquier archivo del servidor).',
  },
  favicon_url: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Igual que og_imagen: solo la escribe el endpoint de subida.',
  },
  // --- Navegación ---
  destino_cta: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Un NavigationTarget: { tipo: "external_url"|"builder_page"|"funnel_step"|"gesicomm_product"|"checkout"|"upsell", ... }. Lo resuelve el token {{cta}} en builderNavegacion.service.js. checkout/upsell están declarados pero todavía no implementados.',
  },
  // --- Punteros de versión (FK circulares con builder_page_versions) ---
  draft_version_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'La versión que se está editando. La mueve cada guardado.',
  },
  published_version_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'La ÚNICA versión que sirve la ruta pública. Solo la mueve publicar. Si es null, la página no es visible para el visitante.',
  },
  published_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Se conserva al despublicar: published_version_id null + published_at no null = "unpublished", distinto de un borrador que nunca se publicó.',
  },
}, {
  tableName: 'builder_pages',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  // Los índices parciales de slug (WHERE funnel_id IS NULL / IS NOT NULL)
  // y la UNIQUE (id, funnel_id) que sostiene la FK compuesta no se pueden
  // expresar acá: viven solo en la migración.
  indexes: [
    { fields: ['proyecto_id'] },
    { fields: ['usuario_id'] },
  ],
});

module.exports = BuilderPage;
