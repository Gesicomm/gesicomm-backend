'use strict';

const crypto = require('crypto');
const path = require('path');
const { Tienda, TiendaFont } = require('../models');
const { R2Service, IMMUTABLE_CACHE_CONTROL } = require('./r2/r2.service');

const DEFAULT_HEADING = 'outfit';
const DEFAULT_BODY = 'outfit';
const MAX_FONT_SIZE = 4 * 1024 * 1024;

const SYSTEM_FONTS = [
  { id: 'outfit', label: 'Outfit', family: 'Outfit', cssFamily: "'Outfit', system-ui, sans-serif", source: 'system', weights: [400, 500, 600, 700] },
  { id: 'inter', label: 'Inter', family: 'Inter', cssFamily: "'Inter', system-ui, sans-serif", source: 'google', weights: [400, 500, 600, 700] },
  { id: 'poppins', label: 'Poppins', family: 'Poppins', cssFamily: "'Poppins', system-ui, sans-serif", source: 'google', weights: [400, 500, 600, 700] },
  { id: 'roboto', label: 'Roboto', family: 'Roboto', cssFamily: "'Roboto', system-ui, sans-serif", source: 'google', weights: [400, 500, 700] },
  { id: 'montserrat', label: 'Montserrat', family: 'Montserrat', cssFamily: "'Montserrat', system-ui, sans-serif", source: 'google', weights: [400, 500, 600, 700] },
  { id: 'lato', label: 'Lato', family: 'Lato', cssFamily: "'Lato', system-ui, sans-serif", source: 'google', weights: [400, 700] },
  { id: 'playfair-display', label: 'Playfair Display', family: 'Playfair Display', cssFamily: "'Playfair Display', Georgia, serif", source: 'google', weights: [400, 600, 700] },
];

const SYSTEM_BY_ID = new Map(SYSTEM_FONTS.map(font => [font.id, font]));
const MIME_BY_EXT = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

function cssString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function slug(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'fuente';
}

function limpiarNombre(value, fallback = 'Fuente personalizada') {
  return String(value || fallback).trim().replace(/\s+/g, ' ').slice(0, 120) || fallback;
}

function inferirPeso(nombre = '') {
  const n = nombre.toLowerCase();
  if (/(bold|700|black|extrabold)/.test(n)) return 700;
  if (/(semibold|semi-bold|600)/.test(n)) return 600;
  if (/(medium|500)/.test(n)) return 500;
  return 400;
}

function normalizarPesos(valor, fallback) {
  const entrada = Array.isArray(valor) ? valor : [valor ?? fallback];
  const pesos = [...new Set(entrada.map(Number).filter(n => [400, 500, 600, 700].includes(n)))];
  return pesos.length ? pesos : [fallback || 400];
}

function fontIdCustom(id) {
  return `custom:${Number(id)}`;
}

function serializeCustomFont(font) {
  const data = font.toJSON ? font.toJSON() : { ...font };
  const weights = normalizarPesos(data.weights, 400);
  return {
    id: fontIdCustom(data.id),
    custom_id: data.id,
    label: data.nombre,
    family: data.family,
    cssFamily: `"${cssString(data.family)}", system-ui, sans-serif`,
    source: 'custom',
    url: data.url,
    storage_key: data.storage_key,
    mime_type: data.mime_type,
    extension: data.extension,
    size: data.size,
    weights,
    style: data.style || 'normal',
    created_at: data.created_at,
  };
}

function normalizarConfig(config = {}, customFonts = []) {
  const customIds = new Set(customFonts.map(f => f.id));
  const valido = (id, fallback) => {
    const valor = String(id || '').trim();
    if (SYSTEM_BY_ID.has(valor) || customIds.has(valor)) return valor;
    return fallback;
  };
  return {
    headingFont: valido(config.headingFont, DEFAULT_HEADING),
    bodyFont: valido(config.bodyFont, DEFAULT_BODY),
  };
}

class TypographyService {
  static catalogoSistema() {
    return SYSTEM_FONTS;
  }

  static async listarCustomFonts(tiendaId) {
    const fonts = await TiendaFont.findAll({ where: { tienda_id: tiendaId }, order: [['created_at', 'DESC'], ['id', 'DESC']] });
    return fonts.map(serializeCustomFont);
  }

  static async obtenerParaTienda(tienda) {
    const customFonts = await this.listarCustomFonts(tienda.id);
    const config = normalizarConfig(tienda.typography || {}, customFonts);
    return {
      headingFont: config.headingFont,
      bodyFont: config.bodyFont,
      systemFonts: this.catalogoSistema(),
      customFonts,
    };
  }

  static async guardarConfigTienda(tiendaId, usuarioId, payload = {}) {
    const tienda = await Tienda.findOne({ where: { id: tiendaId, usuario_id: usuarioId } });
    if (!tienda) throw new Error('Todavía no tenés una tienda creada.');
    const customFonts = await this.listarCustomFonts(tienda.id);
    tienda.typography = normalizarConfig(payload, customFonts);
    tienda.changed('typography', true);
    await tienda.save();
    return this.obtenerParaTienda(tienda);
  }

  static async subirFuente(tiendaId, usuarioId, file, payload = {}) {
    const tienda = await Tienda.findOne({ where: { id: tiendaId, usuario_id: usuarioId } });
    if (!tienda) throw new Error('Todavía no tenés una tienda creada.');
    if (!file) throw new Error('No se recibió ningún archivo.');
    if (file.size > MAX_FONT_SIZE) throw new Error('La fuente no puede pesar más de 4 MB.');

    const ext = path.extname(file.originalname || '').toLowerCase();
    const contentType = MIME_BY_EXT[ext];
    if (!contentType) throw new Error('Solo se permiten fuentes .woff2, .woff, .ttf u .otf.');
    if (file.mimetype && !['font/woff2', 'font/woff', 'font/ttf', 'font/otf', 'application/font-woff', 'application/x-font-ttf', 'application/x-font-otf', 'application/octet-stream'].includes(file.mimetype)) {
      throw new Error('El tipo de archivo de la fuente no es válido.');
    }

    const nombre = limpiarNombre(payload.nombre || path.basename(file.originalname || '', ext));
    const family = limpiarNombre(payload.family || nombre, nombre);
    const weight = inferirPeso(`${payload.weight || ''} ${file.originalname || ''}`);
    const weights = normalizarPesos(payload.weights, weight);
    const storageKey = `tiendas/fonts/${tienda.id}/${slug(family)}-${crypto.randomUUID()}${ext}`;
    const result = await R2Service.uploadObject({
      key: storageKey,
      body: file.buffer,
      contentType,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
      contentLength: file.size,
    });

    const font = await TiendaFont.create({
      tienda_id: tienda.id,
      nombre,
      family,
      url: result.url,
      storage_key: storageKey,
      mime_type: contentType,
      extension: ext.slice(1),
      size: file.size,
      weights,
      metadata: {
        original_name: file.originalname || null,
        detected_weight: weight,
      },
    });
    return serializeCustomFont(font);
  }

  static async eliminarFuente(tiendaId, usuarioId, fontId) {
    const tienda = await Tienda.findOne({ where: { id: tiendaId, usuario_id: usuarioId } });
    if (!tienda) throw new Error('Todavía no tenés una tienda creada.');
    const font = await TiendaFont.findOne({ where: { id: Number(fontId), tienda_id: tienda.id } });
    if (!font) throw new Error('Fuente no encontrada.');

    const customId = fontIdCustom(font.id);
    if (tienda.typography?.headingFont === customId || tienda.typography?.bodyFont === customId) {
      throw new Error('No podés eliminar una fuente que está en uso en la tienda.');
    }

    await font.destroy();
    await R2Service.deleteObject(font.storage_key).catch(() => {});
    return { ok: true };
  }

  static async resolver(tienda, landing = null) {
    const customFonts = await this.listarCustomFonts(tienda.id);
    const storeConfig = normalizarConfig(tienda.typography || {}, customFonts);
    const landingConfig = landing?.typography && landing.typography.mode === 'custom'
      ? normalizarConfig(landing.typography, customFonts)
      : null;
    const resolved = landingConfig || storeConfig;
    return {
      mode: landingConfig ? 'custom' : 'inherit',
      headingFont: resolved.headingFont,
      bodyFont: resolved.bodyFont,
      systemFonts: this.catalogoSistema(),
      customFonts,
    };
  }

  static cssFor(typography = {}) {
    const customById = new Map((typography.customFonts || []).map(font => [font.id, font]));
    const fontById = (id) => customById.get(id) || SYSTEM_BY_ID.get(id) || SYSTEM_BY_ID.get(DEFAULT_BODY);
    const heading = fontById(typography.headingFont);
    const body = fontById(typography.bodyFont);
    const usedCustom = [heading, body].filter(font => font?.source === 'custom');
    const faceCss = [...new Map(usedCustom.map(font => [font.id, font])).values()].map(font => {
      const weight = normalizarPesos(font.weights, 400)[0];
      return `@font-face{font-family:"${cssString(font.family)}";src:url("${cssString(font.url)}") format("${font.extension === 'woff2' ? 'woff2' : font.extension === 'woff' ? 'woff' : 'truetype'}");font-weight:${weight};font-style:${font.style || 'normal'};font-display:swap;}`;
    }).join('\n');
    return {
      headingFamily: heading?.cssFamily || SYSTEM_BY_ID.get(DEFAULT_HEADING).cssFamily,
      bodyFamily: body?.cssFamily || SYSTEM_BY_ID.get(DEFAULT_BODY).cssFamily,
      fontFaces: faceCss,
    };
  }
}

module.exports = TypographyService;
