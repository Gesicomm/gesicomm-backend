'use strict';

const crypto = require('crypto');
const sharp = require('sharp');
const sanitizeHtml = require('sanitize-html');
const { Op, QueryTypes } = require('sequelize');
const { sequelize, Usuario, MensajeContacto, ProveedorServicio } = require('../models');
const { R2Service, IMMUTABLE_CACHE_CONTROL } = require('./r2/r2.service');
const { CATEGORIAS } = require('./solicitudProveedor.service');
const { resumenDocumentos } = require('./proveedorDocumentos.service');

const PREFIJO = 'Gesicom · Postulación de proveedor · ';
const error = (status, message) => Object.assign(new Error(message), { status });
const filtroPostulacion = email => ({ area: 'comercial', email: email.toLowerCase(), asunto: { [Op.startsWith]: PREFIJO } });

function limpiarDetalle(html, imagenes = []) {
  const permitidas = new Set(imagenes.map(imagen => imagen.url));
  return sanitizeHtml(String(html || ''), {
    allowedTags: ['p', 'div', 'br', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'blockquote', 'a', 'img'],
    allowedAttributes: { a: ['href'], img: ['src', 'alt'] },
    allowedSchemes: ['https', 'http', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['https', 'http'] },
    allowProtocolRelative: false,
    exclusiveFilter: frame => frame.tag === 'img' && !permitidas.has(frame.attribs.src),
    transformTags: { a: (_tag, attrs) => ({ tagName: 'a', attribs: { href: attrs.href || '' } }) },
  });
}

function normalizarVideo(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  let parsed;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtu.be' || host === 'youtube.com' || host === 'm.youtube.com') {
    const id = host === 'youtu.be' ? parsed.pathname.slice(1) : parsed.pathname === '/watch' ? parsed.searchParams.get('v') : parsed.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1];
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? `https://www.youtube.com/watch?v=${id}` : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = parsed.pathname.match(/^\/(?:video\/)?(\d+)(?:\/|$)/)?.[1];
    return id ? `https://vimeo.com/${id}` : null;
  }
  return null;
}

class ProveedorPortalService {
  static async cuenta(usuarioId) {
    const usuario = await Usuario.findByPk(usuarioId, { attributes: ['id', 'nombre', 'correo_electronico', 'email_verificado'] });
    if (!usuario || !usuario.email_verificado) throw error(403, 'Verificá tu correo para usar el espacio de proveedor.');
    const [rol] = await sequelize.query(`SELECT 1 FROM usuario_roles_adicionales ura
      JOIN roles r ON r.id = ura.rol_id WHERE ura.usuario_id = :usuarioId AND r.nombre = 'proveedor' LIMIT 1`,
    { replacements: { usuarioId }, type: QueryTypes.SELECT });
    const where = filtroPostulacion(usuario.correo_electronico);
    const aceptada = await MensajeContacto.findOne({ where: { ...where, revision_proveedor: 'aceptada' }, order: [['revisado_en', 'DESC'], ['id', 'DESC']] });
    const reciente = aceptada || await MensajeContacto.findOne({ where, order: [['created_at', 'DESC'], ['id', 'DESC']] });
    return { usuario, rolProveedor: Boolean(rol), postulacion: reciente };
  }

  static async activar(usuarioId) {
    const { usuario } = await this.cuenta(usuarioId);
    await sequelize.query(`INSERT INTO usuario_roles_adicionales (usuario_id, rol_id)
      SELECT :usuarioId, id FROM roles WHERE nombre = 'proveedor'
      ON CONFLICT (usuario_id, rol_id) DO NOTHING`, { replacements: { usuarioId: usuario.id } });
    return this.estado(usuarioId);
  }

  static async estado(usuarioId) {
    const { usuario, rolProveedor, postulacion } = await this.cuenta(usuarioId);
    return { rol_proveedor: rolProveedor, nombre: usuario.nombre, email: usuario.correo_electronico,
      postulacion: postulacion ? { id: postulacion.id, estado: postulacion.revision_proveedor, especialidad: postulacion.datos_proveedor?.especialidad || '', foto_url: postulacion.datos_proveedor?.foto_url || '', documentos: resumenDocumentos(postulacion.datos_proveedor) } : null };
  }

  static async aprobada(usuarioId) {
    const cuenta = await this.cuenta(usuarioId);
    if (!cuenta.rolProveedor) throw error(403, 'Activá tu espacio de proveedor para continuar.');
    if (!cuenta.postulacion || cuenta.postulacion.revision_proveedor !== 'aceptada') throw error(403, 'Tu postulación debe estar aprobada para editar servicios.');
    return cuenta.postulacion;
  }

  static async listar(usuarioId) {
    const postulacion = await this.aprobada(usuarioId);
    return ProveedorServicio.findAll({ where: { solicitud_id: postulacion.id }, order: [['updated_at', 'DESC'], ['id', 'DESC']] });
  }

  static async crear(usuarioId) {
    const postulacion = await this.aprobada(usuarioId);
    return ProveedorServicio.create({ solicitud_id: postulacion.id,
      categoria: CATEGORIAS[postulacion.datos_proveedor?.categoria] ? postulacion.datos_proveedor.categoria : 'partner_certificado' });
  }

  static async propio(usuarioId, id) {
    const postulacion = await this.aprobada(usuarioId);
    const servicio = await ProveedorServicio.findOne({ where: { id, solicitud_id: postulacion.id } });
    if (!servicio) throw error(404, 'Servicio no encontrado.');
    return servicio;
  }

  static async guardar(usuarioId, id, datos) {
    const servicio = await this.propio(usuarioId, id);
    const existentes = Array.isArray(servicio.imagenes) ? servicio.imagenes : [];
    let imagenes = existentes;
    if (datos.imagenes) {
      const porClave = new Map(existentes.map(imagen => [imagen.storage_key, imagen]));
      if (datos.imagenes.length !== existentes.length || new Set(datos.imagenes.map(imagen => imagen.storage_key)).size !== existentes.length || datos.imagenes.some(imagen => !porClave.has(imagen.storage_key))) {
        throw error(400, 'La galería cambió. Actualizá la página y volvé a intentar.');
      }
      imagenes = datos.imagenes.map(imagen => ({ ...porClave.get(imagen.storage_key), alt: imagen.alt.trim().slice(0, 120) }));
    }
    const videos = (datos.video_urls || []).map(normalizarVideo);
    if (videos.some(url => !url)) throw error(400, 'Usá enlaces HTTPS válidos de YouTube o Vimeo.');
    const titulo = datos.titulo.trim();
    const resumen = datos.resumen.trim();
    const detalle_html = limpiarDetalle(datos.detalle_html, imagenes);
    if (datos.estado === 'publicado' && (titulo.length < 5 || resumen.length < 30)) throw error(400, 'Para publicar, agregá un título y una descripción de al menos 30 caracteres.');
    await servicio.update({ categoria: datos.categoria, titulo, resumen, detalle_html,
      beneficios: datos.beneficios.map(v => v.trim()).filter(Boolean), video_urls: videos,
      imagenes, estado: datos.estado });
    return servicio;
  }

  static async subirImagen(usuarioId, id, archivo) {
    const servicio = await this.propio(usuarioId, id);
    if ((servicio.imagenes || []).length >= 6) throw error(400, 'Cada servicio admite hasta seis imágenes.');
    if (!archivo || !['image/jpeg', 'image/png', 'image/webp'].includes(archivo.mimetype)) throw error(400, 'Subí un JPG, PNG o WebP.');
    let buffer;
    try {
      const meta = await sharp(archivo.buffer).metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format) || meta.width < 200 || meta.height < 200 || meta.width * meta.height > 30000000) throw error(400, 'La imagen debe tener al menos 200 × 200 píxeles.');
      buffer = await sharp(archivo.buffer).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();
    } catch (err) { if (err.status) throw err; throw error(400, 'No pudimos procesar esa imagen.'); }
    const key = `proveedores/servicios/${id}/${Date.now()}-${crypto.randomBytes(12).toString('hex')}.webp`;
    const uploaded = await R2Service.uploadObject({ key, body: buffer, contentType: 'image/webp', cacheControl: IMMUTABLE_CACHE_CONTROL, contentLength: buffer.length });
    try {
      const imagen = { storage_key: key, url: uploaded.url, alt: archivo.originalname?.slice(0, 120) || 'Imagen del servicio' };
      await sequelize.transaction(async transaction => {
        const actual = await ProveedorServicio.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!actual || actual.solicitud_id !== servicio.solicitud_id) throw error(404, 'Servicio no encontrado.');
        if ((actual.imagenes || []).length >= 6) throw error(400, 'Cada servicio admite hasta seis imágenes.');
        await actual.update({ imagenes: [...(actual.imagenes || []), imagen] }, { transaction });
      });
      return imagen;
    } catch (err) { await R2Service.deleteObject(key).catch(() => {}); throw err; }
  }

  static async quitarImagen(usuarioId, id, storageKey) {
    const servicio = await this.propio(usuarioId, id);
    const imagenes = Array.isArray(servicio.imagenes) ? servicio.imagenes : [];
    if (!imagenes.some(imagen => imagen.storage_key === storageKey)) throw error(404, 'Imagen no encontrada en este servicio.');
    const siguientes = imagenes.filter(imagen => imagen.storage_key !== storageKey);
    await servicio.update({ imagenes: siguientes, detalle_html: limpiarDetalle(servicio.detalle_html, siguientes) });
    await R2Service.deleteObject(storageKey).catch(() => {});
    return servicio;
  }

  static async publico(id) {
    const servicio = await ProveedorServicio.findOne({ where: { id, estado: 'publicado' } });
    if (!servicio) throw error(404, 'Servicio no encontrado.');
    const postulacion = await MensajeContacto.findOne({ where: { id: servicio.solicitud_id, revision_proveedor: 'aceptada', area: 'comercial', asunto: { [Op.startsWith]: PREFIJO } } });
    if (!postulacion) throw error(404, 'Servicio no encontrado.');
    const perfil = postulacion.datos_proveedor || {};
    return { id: servicio.id, nombre: postulacion.nombre, categoria: servicio.categoria,
      especialidad: servicio.categoria === 'partner_certificado' ? 'Otros servicios' : CATEGORIAS[servicio.categoria] || 'Servicios',
      oferta: servicio.titulo, descripcion: servicio.resumen, detalle_html: limpiarDetalle(servicio.detalle_html, servicio.imagenes),
      beneficios: servicio.beneficios, video_urls: servicio.video_urls, imagenes: servicio.imagenes.map(imagen => ({ url: imagen.url, alt: imagen.alt })),
      foto_url: perfil.foto_url, whatsapp: perfil.whatsapp };
  }
}

module.exports = ProveedorPortalService;
module.exports.limpiarDetalle = limpiarDetalle;
module.exports.normalizarVideo = normalizarVideo;
