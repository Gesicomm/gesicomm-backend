'use strict';

const { Op } = require('sequelize');
const { MensajeContacto } = require('../models');

/**
 * Casilla única de contacto de Gesicomm. Es la misma que se publica en el
 * sitio y en las políticas: no hay direcciones separadas por área.
 *
 * `area` no cambia el destinatario, sirve para clasificar y priorizar la
 * bandeja: las consultas de privacidad y legales tienen plazos normativos
 * que cumplir y hay que poder distinguirlas de una consulta comercial.
 */
const CORREO_CONTACTO = 'contacto@gesicomm.com';

class MensajeContactoService {
  static async crear(datos, contexto = {}) {
    const { area = 'soporte', nombre, email, empresa, asunto, mensaje } = datos;

    const registro = await MensajeContacto.create({
      area,
      nombre: String(nombre).trim(),
      email: String(email).trim().toLowerCase(),
      empresa: empresa ? String(empresa).trim() : null,
      asunto: String(asunto).trim(),
      mensaje: String(mensaje).trim(),
      ip_solicitante: contexto.ip || null,
      user_agent: contexto.userAgent ? String(contexto.userAgent).slice(0, 500) : null,
    });

    return {
      id: registro.id,
      area: registro.area,
      derivado_a: CORREO_CONTACTO,
      recibido_en: registro.created_at,
    };
  }

  static async listar(filtros = {}) {
    const { estado, area, page = 1, limit = 20 } = filtros;
    const where = {};
    if (estado) where.estado = estado;
    if (area) where.area = area;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { rows, count } = await MensajeContacto.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    return {
      total: count,
      pagina: parseInt(page),
      total_paginas: Math.ceil(count / parseInt(limit)),
      mensajes: rows.map((m) => ({
        id: m.id,
        area: m.area,
        estado: m.estado,
        nombre: m.nombre,
        email: m.email,
        empresa: m.empresa,
        asunto: m.asunto,
        mensaje: m.mensaje,
        recibido_en: m.created_at,
      })),
    };
  }
}

module.exports = MensajeContactoService;
module.exports.CORREO_CONTACTO = CORREO_CONTACTO;
