'use strict';

/**
 * Feed de productos para el Catálogo de Meta (Commerce Manager → "scheduled
 * fetch" de una URL, CSV). El id de cada fila es a propósito el mismo
 * content_id que ya usan el Pixel y la Conversions API (ver
 * metaCapi.service.js y LandingService.obtenerCatalogoParaEvento): así Meta
 * puede cruzar un evento ViewContent/Purchase con la fila del catálogo sin
 * que el comercio tenga que mapear nada a mano.
 *
 * Arma el CSV en lotes (no carga el catálogo entero a memoria): el mismo
 * error — traer todo un catálogo grande de una — tumbó el backend por OOM
 * el 2026-10-16 (ver mcp.service.js, obtenerContextoComercial).
 */

const { Op } = require('sequelize');
const { Producto } = require('../models');
const LandingService = require('./landing.service');
const Proyeccion = require('./metaFeedProjection.service');


const CAMPOS_CSV = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];

function dominioDeTienda(tienda) {
  return tienda.dominio_propio_verificado && tienda.dominio_propio_habilitado && tienda.dominio_propio
    ? tienda.dominio_propio
    : `${tienda.subdominio}.${process.env.TIENDA_DOMINIO_BASE || 'gesicomm.com'}`;
}

/** Despoja tags HTML y colapsa espacios — descripcion_larga se guarda como HTML del editor. */
function textoPlano(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Una celda CSV: comillas dobles si tiene coma, comilla o salto de línea (RFC 4180). */
function celda(valor) {
  const texto = String(valor ?? '');
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/**
 * @param {object} datos - plano, no una instancia de Sequelize: id, slug,
 *   nombre, descripcion, cantidadDisponible, precioEfectivo, imagenUrl, marca.
 */
function filaCsv(datos, dominio) {
  const contentId = datos.content_id || datos.meta_content_id || datos.slug || `producto-${datos.id}`;
  const descripcion = textoPlano(datos.descripcion).slice(0, 5000);
  const disponible = datos.cantidadDisponible === null || datos.cantidadDisponible === undefined
    ? true // no rastrea stock: siempre a la venta, mismo criterio que la vitrina pública
    : Number(datos.cantidadDisponible) > 0;

  const fila = {
    id: contentId,
    title: datos.nombre,
    description: descripcion || datos.nombre,
    availability: disponible ? 'in stock' : 'out of stock',
    condition: 'new',
    price: `${Math.round(datos.precioEfectivo)} PYG`,
    link: `https://${dominio}/${contentId}`,
    image_link: datos.imagenUrl,
    brand: datos.marca,
  };
  return CAMPOS_CSV.map(campo => celda(fila[campo])).join(',');
}

/** The feed consumes the same public DTO as the storefront and checkout. */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const MetaFeed = require('../models/MetaFeed');
const { Tienda, Usuario, Landing, LandingItem, LandingTemplate } = require('../models');
const DIRECTORIO = process.env.META_FEED_DIR || path.resolve(__dirname, '../../storage/meta-feeds');
const LIMITE = Math.max(1, Math.min(20000, Number(process.env.META_FEED_MAX_ITEMS) || 5000));
const LOTE_PUBLICO = 500;
const trabajos = new Map();
const clave = i => `${i.tipo}:${Number(i.referencia_id ?? i.id)}`;
const idPublico = i => i.content_id || (i.tipo === 'combo' ? `combo-${i.id}` : i.meta_content_id || i.slug || `producto-${i.id}`);

function fallo(message, status = 422) { return Object.assign(new Error(message), { status }); }

async function tiendaPrivada(usuario) {
  if (!usuario.tiendaId) throw fallo('Seleccioná una tienda primero.', 409);
  const tienda = await Tienda.findOne({ where: {
    id: usuario.tiendaId, usuario_id: usuario.id, inquilino_id: usuario.tenantId,
  }, include: [{ model: Usuario, attributes: ['id', 'activo'] }] });
  if (!tienda) throw fallo('Tienda no encontrada.', 404);
  return tienda;
}

async function configuracion(tienda) {
  return (await MetaFeed.findOrCreate({ where: { tienda_id: tienda.id, landing_id: tienda.feed_landing_id } }))[0];
}

async function candidatos(tienda) {
  const landing = await Landing.findOne({ where: { tienda_id: tienda.id, id: tienda.feed_landing_id, activo: true },
    attributes: ['id', 'tipo_pagina', 'producto_id'],
    include: [{ model: LandingItem, as: 'items', attributes: ['tipo', 'referencia_id'], separate: true }] });
  if (!landing || !tienda.activo || !tienda.Usuario?.activo) throw fallo('Guardá y publicá esta landing antes de preparar el feed.', 409);
  const items = landing.tipo_pagina === 'funnel' && landing.producto_id && !landing.items?.length
      ? [{ tipo: 'producto', referencia_id: landing.producto_id }]
      : landing.items || [];
  const ids = items.filter(i => i.tipo === 'producto').map(i => i.referencia_id);
  const visibles = await LandingService.whereVisibleEnTienda(tienda);
  const productos = ids.length ? await Producto.findAll({ where: {
    [Op.and]: [{ id: { [Op.in]: ids }, inquilino_id: tienda.inquilino_id, activo: true, estado_venta: 'en_venta' }, visibles],
  }, attributes: ['id', 'slug', 'meta_content_id', 'nombre', 'categoria_id', 'proveedor_id', 'tags'] }) : [];
  // Combos retain their existing combo-{id} event IDs. Their payload is resolved by the public service.
  const { ProductoCombo } = require('../models');
  const comboIds = items.filter(i => i.tipo === 'combo').map(i => i.referencia_id);
  const combos = comboIds.length ? await ProductoCombo.findAll({ where: {
    id: { [Op.in]: comboIds }, inquilino_id: tienda.inquilino_id, activo: true,
  }, attributes: ['id', 'nombre'] }) : [];
  return [...productos.map(p => ({ tipo: 'producto', referencia_id: p.id, content_id: idPublico(p),
    nombre: p.nombre, categoria_id: p.categoria_id, proveedor_id: p.proveedor_id, tags: p.tags || [] })),
  ...combos.map(c => ({ tipo: 'combo', referencia_id: c.id, content_id: `combo-${c.id}`, nombre: c.nombre }))]
    .sort((a,b) => clave(a).localeCompare(clave(b)));
}

function filtrar(items, filtros = {}) {
  const q = String(filtros.q || '').trim().toLowerCase().slice(0, 100);
  const individuales = Array.isArray(filtros.claves) ? new Set(filtros.claves) : null;
  return items.filter(i => (!q || i.nombre.toLowerCase().includes(q))
    && (!filtros.categoria_id || Number(i.categoria_id) === Number(filtros.categoria_id))
    && (!filtros.proveedor_id || Number(i.proveedor_id) === Number(filtros.proveedor_id))
    && (!filtros.coleccion || i.tags?.includes(filtros.coleccion))
    && (!individuales || individuales.has(clave(i))));
}
function huella(items, revision, tiendaId) {
  return crypto.createHash('sha256').update(JSON.stringify([tiendaId, revision, items.map(clave).sort()])).digest('hex');
}

async function estado(tienda) {
  const c = await configuracion(tienda);
  return { landing_id: tienda.feed_landing_id, activo: c.activo, seleccionados: (await candidatos(tienda)).length, limite: LIMITE, revision: c.revision,
    pendiente: c.revision !== c.revision_generada || trabajos.has(tienda.feed_landing_id),
    url: `https://${dominioDeTienda(tienda)}/api/l/feed-productos.csv?landing=${tienda.feed_landing_id}`,
    generado_at: c.generado_at, descargado_at: c.descargado_at, cantidad: c.cantidad,
    omitidos: c.omitidos, error: c.error, nuevos: 'manual' };
}
async function activar(tienda, activo) {
  if (typeof activo !== 'boolean') throw fallo('Indicá si el feed debe estar activo.');
  const c = await configuracion(tienda);
  if (activo) await candidatos(tienda); // An unavailable storefront must never result in an empty replacement feed.
  await c.update({ activo, revision: c.revision + 1 });
  if (activo) solicitar(tienda.feed_landing_id);
  return estado(tienda);
}

function urlHttp(valor, dominio) {
  if (typeof valor !== 'string' || !valor) return null;
  try { const u = new URL(valor, `https://${dominio}`); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}
function filaPublica(item, tienda) {
  const dominio = dominioDeTienda(tienda);
  const imagen = urlHttp(item.imagen, dominio);
  if (!imagen || !Number.isFinite(Number(item.precio)) || Number(item.precio) <= 0 || !item.nombre) return null;
  return filaCsv({ content_id: item.content_id, nombre: item.nombre,
    descripcion: item.descripcion_larga || item.descripcion, cantidadDisponible: item.stock,
    precioEfectivo: Number(item.precio), imagenUrl: imagen, marca: item.marca || tienda.nombre }, dominio);
}

async function generar(landingId) {
  // Shared database lock protects snapshots across multiple Node processes/replicas.
  return MetaFeed.sequelize.transaction(async transaction => {
    const [[lock]] = await MetaFeed.sequelize.query('SELECT pg_try_advisory_xact_lock(74261, :landingId) AS locked', { replacements: { landingId }, transaction });
    if (!lock.locked) return;
    const c = await MetaFeed.findOne({ where: { landing_id: landingId }, transaction });
    if (!c?.activo) return;
    const tienda = await Tienda.findByPk(c.tienda_id, { include: [{ model: Usuario, attributes: ['id', 'activo'] }] });
    tienda.feed_landing_id = landingId;
    const { sequelize } = require('../models');
    const fuente = await Landing.findOne({ where: { id: landingId, tienda_id: tienda.id },
      attributes: ['id', 'slug', [sequelize.literal("content->'productos'"), 'productos'], [sequelize.literal("content->'combos'"), 'combos']], raw: true });
    tienda.feed_slug = fuente?.slug;
    const visibles = await LandingService.whereVisibleEnTienda(tienda);
    const elegidos = await candidatos(tienda);
    if (elegidos.length > LIMITE) throw fallo('La selección supera la capacidad del feed.');
    await fs.mkdir(DIRECTORIO, { recursive: true });
    const temporal = await fs.mkdtemp(path.join(DIRECTORIO, `landing-${landingId}-`));
    const archivoTemporal = path.join(temporal, 'productos.csv');
    let file;
    let cantidad = 0;
    const omitidos = [];
    try {
      file = await fs.open(archivoTemporal, 'wx');
      await file.writeFile(CAMPOS_CSV.join(',') + '\r\n');
      for (let offset = 0; offset < elegidos.length; offset += LOTE_PUBLICO * 2) {
        // Two bounded commercial batches overlap database latency. Never fan
        // out the entire catalogue or hydrate full storefront DTOs.
        const lotes = [elegidos.slice(offset, offset + LOTE_PUBLICO), elegidos.slice(offset + LOTE_PUBLICO, offset + LOTE_PUBLICO * 2)].filter(l => l.length);
        const resultados = await Promise.all(lotes.map(lote => Proyeccion.leerLote(tienda, fuente, lote, visibles)));
        for (let indice = 0; indice < lotes.length; indice++) {
        const lote = lotes[indice];
        const data = { disponible: true, items: resultados[indice] };
        if (!data?.disponible || !Array.isArray(data.items)) throw fallo('No se pudo completar la lectura del catálogo publicado.');
        const esperados = new Set(lote.map(i => i.content_id));
        const recibidos = new Set();
        const lineas = [];
        for (const item of data.items) {
          if (!esperados.has(item.content_id) || recibidos.has(item.content_id)) continue;
          recibidos.add(item.content_id);
          const fila = filaPublica(item, tienda);
          if (fila) { lineas.push(fila); cantidad++; }
          else omitidos.push({ clave: item.content_id, motivo: 'Revisá el título, la imagen y el precio de venta (debe ser mayor a cero).' });
        }
        // A mismatch can be caused by an edit mid-scan: preserve the last complete feed.
        if (recibidos.size !== esperados.size) throw fallo('El catálogo cambió durante la generación. Se conserva el feed anterior y se reintentará.');
        if (lineas.length) await file.writeFile(lineas.join('\r\n') + '\r\n');
        }
        await new Promise(resolve => setImmediate(resolve));
      }
      await file.close(); file = null;
      // A revision fence prevents a slow, older build from overwriting a newer selection.
      const actual = await MetaFeed.findOne({ where: { landing_id: landingId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!actual.activo || actual.revision !== c.revision) return;
      const destino = path.join(DIRECTORIO, `${landingId}.csv`);
      await fs.rename(archivoTemporal, destino);
      await actual.update({ archivo: `${landingId}.csv`, revision_generada: c.revision,
        generado_at: new Date(), cantidad, omitidos: omitidos.slice(0, 5000), error: null }, { transaction });
    } finally {
      if (file) await file.close();
      await fs.rm(archivoTemporal, { force: true });
      await fs.rmdir(temporal);
    }
  });
}
function solicitar(landingId) {
  if (trabajos.has(landingId)) return trabajos.get(landingId);
  const job = generar(landingId).catch(async err => {
    console.error('[meta-feed] Falló generación para landing', landingId);
    // Never store raw remote responses, tokens or request URLs in diagnostics.
    await MetaFeed.update({ error: 'No se pudo completar el feed. Se conserva la última versión completa; revisá la publicación y reintentá.' }, { where: { landing_id: landingId } }).catch(() => {});
  }).finally(() => trabajos.delete(landingId));
  trabajos.set(landingId, job);
  return job;
}
async function archivoPublico(tienda) {
  const c = await MetaFeed.findOne({ where: { tienda_id: tienda.id, landing_id: tienda.feed_landing_id } });
  if (!c?.activo || !tienda.activo || !tienda.Usuario?.activo) throw fallo('El feed está pausado o no fue activado.', 503);
  if (!c.generado_at || Date.now() - new Date(c.generado_at).getTime() > 60000 || c.revision !== c.revision_generada) solicitar(tienda.feed_landing_id);
  const archivo = path.join(DIRECTORIO, `${tienda.feed_landing_id}.csv`);
  if (!c.archivo || !(await fs.stat(archivo).catch(() => null))?.isFile()) { solicitar(tienda.feed_landing_id); throw fallo('El feed se está preparando. Volvé a intentarlo en un minuto.', 503); }
  return { archivo, config: c };
}
function iniciarJobMetaFeed() {
  if (process.env.NODE_ENV === 'test') return;
  let ocupado = false;
  const tick = async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      // Keyset paging; never hydrate every store or every full catalogue at once.
      let ultimo = 0;
      for (;;) {
        const configs = await MetaFeed.findAll({ where: { activo: true, id: { [Op.gt]: ultimo } }, attributes: ['id', 'landing_id'], order: [['id','ASC']], limit: 100 });
        if (!configs.length) break;
        for (const c of configs) { await solicitar(c.landing_id); ultimo = c.id; }
      }
    } catch { console.error('[meta-feed] No se pudo ejecutar la actualización programada.'); }
    finally { ocupado = false; }
  };
  const timer = setInterval(tick, 60000); timer.unref();
  tick();
  return () => clearInterval(timer);
}

// Used by diagnostics: same published landing, no platform-wide export.
async function* filasFeed(tienda) {
  const items = await candidatos(tienda);
  for (let start=0; start<items.length; start+=LOTE_PUBLICO) {
    const data = await LandingService.obtenerProductosPublicos(tienda, tienda.feed_slug, items.slice(start,start+LOTE_PUBLICO).map(i=>i.content_id));
    if (!data?.disponible || !Array.isArray(data.items)) throw fallo('Catálogo no disponible.');
    yield data.items.map(i => filaPublica(i,tienda)).filter(Boolean);
  }
}
module.exports = { filasFeed, filaCsv, dominioDeTienda, CAMPOS_CSV, filaPublica,
  tiendaPrivada, estado, activar, solicitar, archivoPublico,
  iniciarJobMetaFeed, filtrar, huella, generar, LIMITE, candidatos };
