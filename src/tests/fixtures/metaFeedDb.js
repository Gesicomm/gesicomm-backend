'use strict';
const { Sequelize, DataTypes, Op } = require('sequelize');
// Explicit opt-in: these tests never use the application .env or production database.
const url = process.env.META_FEED_TEST_DATABASE_URL;
if (!url || !/^postgres:\/\/postgres@127\.0\.0\.1:55439\//.test(url)) throw new Error('Usá PostgreSQL de pruebas local en el puerto 55439.');
const sequelize = new Sequelize(url, { logging: false });
const define = (nombre, campos, tabla) => sequelize.define(nombre, { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, ...campos }, { tableName: tabla, timestamps: false });
const Usuario = define('Usuario', { activo: DataTypes.BOOLEAN }, 'usuarios');
const Tienda = define('Tienda', { usuario_id: DataTypes.INTEGER, inquilino_id: DataTypes.INTEGER, activo: DataTypes.BOOLEAN, nombre: DataTypes.STRING, subdominio: DataTypes.STRING }, 'tiendas');
Tienda.belongsTo(Usuario, { foreignKey: 'usuario_id' });
const Producto = define('Producto', { slug: DataTypes.STRING, meta_content_id: DataTypes.STRING, inquilino_id: DataTypes.INTEGER, nombre: DataTypes.STRING, activo: DataTypes.BOOLEAN, estado_venta: DataTypes.STRING, categoria_id: DataTypes.INTEGER, proveedor_id: DataTypes.INTEGER, tags: DataTypes.JSONB }, 'productos');
const LandingTemplate = define('LandingTemplate', { kind: DataTypes.STRING }, 'landing_templates');
const Landing = define('Landing', { tienda_id: DataTypes.INTEGER, activo: DataTypes.BOOLEAN, es_home: DataTypes.BOOLEAN, slug: DataTypes.STRING, template_id: DataTypes.INTEGER, content: DataTypes.JSONB, tipo_pagina: DataTypes.STRING, producto_id: DataTypes.INTEGER }, 'landings');
const LandingItem = define('LandingItem', { landing_id: DataTypes.INTEGER, tipo: DataTypes.STRING, referencia_id: DataTypes.INTEGER }, 'landing_items');
Landing.hasMany(LandingItem, { as: 'items', foreignKey: 'landing_id' });
Landing.belongsTo(LandingTemplate, { as: 'template', foreignKey: 'template_id' });
const ProductoCombo = define('ProductoCombo', { inquilino_id: DataTypes.INTEGER, nombre: DataTypes.STRING, activo: DataTypes.BOOLEAN }, 'producto_combos');
const ajustes = new Map();
const llamadas = [];
let fallaLectura = false;
async function itemsDelLienzo(landing) { return landing.items; }
async function obtenerProductosPublicos(tienda, slug, ids) {
  llamadas.push({ tienda: tienda.id, slug, ids });
  if (fallaLectura) throw new Error('Interrupción simulada');
  const landing = await Landing.findOne({ where: { tienda_id: tienda.id, slug }, include: [{ model: LandingItem, as: 'items' }] });
  if (!landing?.activo) return { disponible: false };
  const publicados = landing.items.map(i => i.referencia_id);
  const productos = await Producto.findAll({ where: { id: publicados, inquilino_id: tienda.inquilino_id, activo: true, [Op.or]: [{ meta_content_id: ids }, { slug: ids }] } });
  return { disponible: true, items: productos.map(p => ({
    content_id: p.meta_content_id, nombre: p.nombre, precio: tienda.id === 1 ? 100000 : 150000,
    stock: 5, imagen: 'https://example.com/foto.jpg', descripcion: 'Descripción comercial',
    ...ajustes.get(`${tienda.id}:${p.id}`),
  })) };
}
module.exports = { sequelize, Tienda, Usuario, Producto, Landing, LandingItem, LandingTemplate, ProductoCombo,
  ajustes, llamadas, itemsDelLienzo, obtenerProductosPublicos,
  whereVisibleEnTienda: async tienda => ({ inquilino_id: tienda.inquilino_id }),
  setFalla: v => { fallaLectura = v; } };
