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
  // --- Filtros visibles en la landing pública ---
  mostrar_filtro_categoria: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  mostrar_filtro_marca: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  mostrar_filtro_etiqueta: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  mostrar_buscador: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  mostrar_orden_precio: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
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
