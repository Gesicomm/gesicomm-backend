'use strict';

const { Op } = require('sequelize');
const { MensajeContacto } = require('../models');
const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

const CATEGORIAS = {
  mercaderias: 'Mercaderías', envios: 'Envíos y logística', editor_videos: 'Editor de videos',
  media_buyer: 'Media buyer / publicidad', webmaster: 'Webmaster / desarrollo web',
  partner_certificado: 'Aspirante a partner certificado Gesicom',
};
const PREFIJO = 'Gesicom · Postulación de proveedor · ';
const filtroProveedor = () => ({ area: 'comercial', asunto: { [Op.startsWith]: PREFIJO } });
const fallo = (status, message) => Object.assign(new Error(message), { status });

function datosProveedor(m) {
  if (m.datos_proveedor) return m.datos_proveedor;
  // Las postulaciones anteriores se guardaron como mensajes. No se pierden
  // ni se copian a otra tabla; el texto original sigue disponible para revisar.
  const linea = etiqueta => String(m.mensaje || '').split('\n').find(l => l.startsWith(etiqueta + ':'))?.slice(etiqueta.length + 1).trim() || '';
  return { documento: linea('Documento'), ruc: linea('RUC'), whatsapp: linea('WhatsApp'),
    especialidad: linea('Especialidad') || m.asunto.slice(PREFIJO.length), descripcion: linea('Descripción') };
}

const presentar = m => ({
  id: m.id, nombre: m.nombre, email: m.email, recibido_en: m.created_at,
  estado: m.revision_proveedor || 'pendiente', datos: datosProveedor(m), mensaje: m.mensaje,
  nota_revision: m.nota_revision, revisado_por: m.revisado_por, revisado_en: m.revisado_en,
});

class SolicitudProveedorService {
  static async crear(datos, contexto = {}) {
    const perfil = { documento: datos.documento, ruc: datos.ruc || '', whatsapp: datos.whatsapp,
      categoria: datos.categoria, especialidad: CATEGORIAS[datos.categoria],
      oferta: datos.oferta, descripcion: datos.descripcion, foto_url: datos.foto_url, foto_storage_key: datos.foto_storage_key };
    const registro = await MensajeContacto.create({
      area: 'comercial', nombre: `${datos.nombre} ${datos.apellido}`, email: datos.email.toLowerCase(),
      asunto: PREFIJO + perfil.especialidad, datos_proveedor: perfil, revision_proveedor: 'pendiente',
      mensaje: ['Origen: landing institucional Gesicom', 'Tipo: Postulación de proveedor',
        `Documento: ${perfil.documento}`, `RUC: ${perfil.ruc || 'No indicado'}`, `WhatsApp: ${perfil.whatsapp}`,
        `Especialidad: ${perfil.especialidad}`, `Servicio: ${perfil.oferta}`, `Descripción: ${perfil.descripcion}`].join('\n'),
      ip_solicitante: contexto.ip || null, user_agent: contexto.userAgent?.slice(0, 500) || null,
    });
    return { id: registro.id, recibido_en: registro.created_at };
  }

  static async listar({ estado, page = 1, limit = 20 } = {}) {
    const where = filtroProveedor();
    if (estado) where.revision_proveedor = estado;
    const [listado, pendientes, aceptadas, rechazadas] = await Promise.all([
      MensajeContacto.findAndCountAll({ where, order: [['created_at', 'DESC'], ['id', 'DESC']], limit, offset: (page - 1) * limit }),
      ...['pendiente', 'aceptada', 'rechazada'].map(revision_proveedor => MensajeContacto.count({ where: { ...filtroProveedor(), revision_proveedor } })),
    ]);
    return { solicitudes: listado.rows.map(presentar), total: listado.count, pagina: page,
      total_paginas: Math.ceil(listado.count / limit), resumen: { pendiente: pendientes, aceptada: aceptadas, rechazada: rechazadas } };
  }

  static async buscarPublicados({ busqueda = '', categoria = '', page = 1, limit = 12 } = {}) {
    const termino = busqueda.trim().slice(0, 100);
    const filtroCategoria = categoria && CATEGORIAS[categoria] ? categoria : '';
    const replacements = { prefijo: `${PREFIJO}%`, termino: `%${termino.replace(/[\\%_]/g, '\\$&')}%`, categoria: filtroCategoria, limit, offset: (page - 1) * limit };
    const where = `area = 'comercial' AND asunto LIKE :prefijo AND revision_proveedor = 'aceptada'
      AND NULLIF(datos_proveedor->>'foto_url', '') IS NOT NULL
      AND NULLIF(datos_proveedor->>'oferta', '') IS NOT NULL
      AND NULLIF(datos_proveedor->>'descripcion', '') IS NOT NULL
      AND (:categoria = '' OR datos_proveedor->>'categoria' = :categoria)
      AND (:termino = '%%' OR (nombre ILIKE :termino ESCAPE '\\' OR datos_proveedor->>'oferta' ILIKE :termino ESCAPE '\\' OR datos_proveedor->>'descripcion' ILIKE :termino ESCAPE '\\'))`;
    const [totalRows, rows] = await Promise.all([
      sequelize.query(`SELECT COUNT(*)::integer AS total FROM mensajes_contacto WHERE ${where}`, { replacements, type: QueryTypes.SELECT }),
      sequelize.query(`SELECT id, nombre, datos_proveedor FROM mensajes_contacto WHERE ${where} ORDER BY revisado_en DESC NULLS LAST, id DESC LIMIT :limit OFFSET :offset`, { replacements, type: QueryTypes.SELECT }),
    ]);
    return { servicios: rows.map(row => ({ id: row.id, nombre: row.nombre,
      categoria: row.datos_proveedor.categoria, especialidad: row.datos_proveedor.categoria === 'partner_certificado' ? 'Otros servicios' : CATEGORIAS[row.datos_proveedor.categoria] || row.datos_proveedor.especialidad,
      oferta: row.datos_proveedor.oferta, descripcion: row.datos_proveedor.descripcion,
      foto_url: row.datos_proveedor.foto_url, whatsapp: row.datos_proveedor.whatsapp })),
    total: totalRows[0]?.total || 0, pagina: page, total_paginas: Math.ceil((totalRows[0]?.total || 0) / limit), categorias: CATEGORIAS };
  }

  static async revisar(id, { estado, nota }, adminId) {
    if (!['aceptada', 'rechazada'].includes(estado)) throw fallo(400, 'Elegí aceptar o rechazar la solicitud.');
    const registro = await MensajeContacto.findOne({ where: { id, ...filtroProveedor() } });
    if (!registro) throw fallo(404, 'Solicitud de proveedor no encontrada.');
    if (registro.revision_proveedor !== 'pendiente') throw fallo(409, 'Esta solicitud ya fue revisada. Actualizá la bandeja para ver la decisión.');
    if (estado === 'aceptada' && !['foto_url', 'oferta', 'descripcion'].every(campo => String(datosProveedor(registro)[campo] || '').trim())) {
      throw fallo(400, 'Esta postulación no tiene foto, servicio y descripción. Pedí esos datos antes de publicarla.');
    }
    // La condición atómica evita que dos administradores se sobrescriban.
    const [cantidad, rows] = await MensajeContacto.update({ revision_proveedor: estado,
      nota_revision: nota?.trim() || null, revisado_por: adminId, revisado_en: new Date(),
    }, { where: { id, revision_proveedor: 'pendiente', ...filtroProveedor() }, returning: true });
    if (!cantidad) throw fallo(409, 'Otro administrador ya revisó esta solicitud. Actualizá la bandeja.');
    return presentar(rows[0]);
  }
}

module.exports = SolicitudProveedorService;
module.exports.CATEGORIAS = CATEGORIAS;
