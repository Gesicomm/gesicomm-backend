'use strict';

const { Op } = require('sequelize');
const { MensajeContacto, ProveedorServicio } = require('../models');
const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');
const { resumenDocumentos } = require('./proveedorDocumentos.service');

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
  estado: m.revision_proveedor || 'pendiente', datos: datosProveedor(m), documentos: resumenDocumentos(datosProveedor(m)), mensaje: m.mensaje,
  nota_revision: m.nota_revision, revisado_por: m.revisado_por, revisado_en: m.revisado_en,
});

class SolicitudProveedorService {
  static async crear(datos, contexto = {}) {
    const perfil = { documento: datos.documento, ruc: datos.ruc || '', whatsapp: datos.whatsapp,
      categoria: datos.categoria, especialidad: CATEGORIAS[datos.categoria],
      oferta: datos.oferta, descripcion: datos.descripcion, foto_url: datos.foto_url, foto_storage_key: datos.foto_storage_key,
      documentos: { cedula_frente: datos.cedula_frente, cedula_dorso: datos.cedula_dorso } };
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
    const where = `m.area = 'comercial' AND m.asunto LIKE :prefijo AND m.revision_proveedor = 'aceptada'
      AND s.estado = 'publicado' AND NULLIF(m.datos_proveedor->>'foto_url', '') IS NOT NULL
      AND (:categoria = '' OR s.categoria = :categoria)
      AND (:termino = '%%' OR (m.nombre ILIKE :termino ESCAPE '\\' OR s.titulo ILIKE :termino ESCAPE '\\' OR s.resumen ILIKE :termino ESCAPE '\\'))`;
    const from = 'FROM proveedor_servicios s JOIN mensajes_contacto m ON m.id = s.solicitud_id';
    const [totalRows, rows] = await Promise.all([
      sequelize.query(`SELECT COUNT(*)::integer AS total ${from} WHERE ${where}`, { replacements, type: QueryTypes.SELECT }),
      sequelize.query(`SELECT s.id, s.categoria, s.titulo, s.resumen, s.imagenes, m.nombre, m.datos_proveedor ${from} WHERE ${where} ORDER BY s.updated_at DESC, s.id DESC LIMIT :limit OFFSET :offset`, { replacements, type: QueryTypes.SELECT }),
    ]);
    return { servicios: rows.map(row => ({ id: row.id, nombre: row.nombre,
      categoria: row.categoria, especialidad: row.categoria === 'partner_certificado' ? 'Otros servicios' : CATEGORIAS[row.categoria] || row.datos_proveedor.especialidad,
      oferta: row.titulo, descripcion: row.resumen,
      foto_url: row.datos_proveedor.foto_url, portada_url: row.imagenes?.[0]?.url || null, whatsapp: row.datos_proveedor.whatsapp })),
    total: totalRows[0]?.total || 0, pagina: page, total_paginas: Math.ceil((totalRows[0]?.total || 0) / limit), categorias: CATEGORIAS };
  }

  static async revisar(id, { estado, nota }, adminId) {
    if (!['aceptada', 'rechazada'].includes(estado)) throw fallo(400, 'Elegí aceptar o rechazar la solicitud.');
    const registro = await MensajeContacto.findOne({ where: { id, ...filtroProveedor() } });
    if (!registro) throw fallo(404, 'Solicitud de proveedor no encontrada.');
    if (registro.revision_proveedor !== 'pendiente') throw fallo(409, 'Esta solicitud ya fue revisada. Actualizá la bandeja para ver la decisión.');
    const documentos = resumenDocumentos(datosProveedor(registro));
    if (estado === 'aceptada' && (!['foto_url', 'oferta', 'descripcion'].every(campo => String(datosProveedor(registro)[campo] || '').trim()) || !documentos.cedula_frente_cargada || !documentos.cedula_dorso_cargada)) {
      throw fallo(400, 'Esta postulación necesita foto de perfil, frente y dorso de cédula, servicio y descripción antes de aprobarla.');
    }
    return sequelize.transaction(async transaction => {
      // La condición atómica evita que dos administradores se sobrescriban.
      const [cantidad, rows] = await MensajeContacto.update({ revision_proveedor: estado,
        nota_revision: nota?.trim() || null, revisado_por: adminId, revisado_en: new Date(),
      }, { where: { id, revision_proveedor: 'pendiente', ...filtroProveedor() }, returning: true, transaction });
      if (!cantidad) throw fallo(409, 'Otro administrador ya revisó esta solicitud. Actualizá la bandeja.');
      if (estado === 'aceptada') {
        const perfil = datosProveedor(rows[0]);
        await ProveedorServicio.findOrCreate({ where: { solicitud_id: id }, defaults: {
          categoria: CATEGORIAS[perfil.categoria] ? perfil.categoria : 'partner_certificado',
          titulo: perfil.oferta, resumen: perfil.descripcion, estado: 'publicado',
        }, transaction });
      }
      return presentar(rows[0]);
    });
  }
}

module.exports = SolicitudProveedorService;
module.exports.CATEGORIAS = CATEGORIAS;
