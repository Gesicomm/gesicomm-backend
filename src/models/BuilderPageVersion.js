const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Una versión inmutable del código de una BuilderPage.
 *
 * REGLA DE ORO: una fila con estado='published' NUNCA se actualiza. Lo
 * único que le puede pasar es pasar a 'archived' cuando se publica otra.
 * De eso depende la garantía central del módulo: el visitante sigue
 * viendo la versión publicada aunque el comercio guarde diez borradores
 * encima. Lo hace cumplir builderPageVersion.service.js.
 *
 *   Guardar  → INSERT versión nueva (draft) + mover page.draft_version_id
 *   Publicar → esa versión pasa a published + mover page.published_version_id
 *
 * El código de acá YA está sanitizado: pasó por
 * LandingCodigoService.sanitizar() antes de insertarse. Ese es el único
 * sanitizador del proyecto y no se duplica — el Page Builder solo le pasa
 * sus propios límites de tamaño.
 *
 * `version` es secuencial POR PÁGINA (1, 2, 3...), no global: es lo que
 * ve el comercio en la pantalla de versiones ("v5 Draft · v4 LIVE").
 *
 * Sin updated_at a propósito: la fila no se actualiza.
 */
const BuilderPageVersion = sequelize.define('BuilderPageVersion', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  pagina_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  version: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Secuencial por página, empieza en 1.',
  },
  html: {
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: '',
    comment: 'Ya pasado por sanitize-html. Se renderiza SIEMPRE dentro del iframe sandbox (ver construirDocumentoCodigo.js del frontend), nunca inyectado en el DOM del dashboard.',
  },
  css: {
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: '',
  },
  js: {
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: '',
    comment: 'Revisado contra el blocklist de landingCodigo.service.js (fetch, cookies, parent/top, etc.). Lo que realmente contiene es el sandbox del iframe, no esta revisión.',
  },
  estado: {
    type: DataTypes.STRING(15),
    allowNull: false,
    defaultValue: 'draft',
    validate: { isIn: [['draft', 'published', 'archived']] },
  },
  nota: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: 'Mensaje libre del comercio ("cambié el titular"), para poder elegir a cuál volver.',
  },
  creado_por: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  bytes: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'html+css+js en bytes. Lo usa la poda de versiones para no dejar crecer la tabla sin control.',
  },
  published_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'builder_page_versions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { unique: true, fields: ['pagina_id', 'version'] },
    { fields: ['pagina_id', 'created_at'] },
  ],
});

module.exports = BuilderPageVersion;
