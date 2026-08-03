'use strict';

const { Op } = require('sequelize');
const { MensajeContacto } = require('../models');

/**
 * Casilla a la que se deriva cada área. Se expone en /contact para que el
 * visitante pueda escribir directo si prefiere no usar el formulario, y es
 * la misma dirección que figura en la Política de Privacidad.
 */
const CASILLAS = {
  soporte: 'support@gesicomm.com',
  privacidad: 'privacy@gesicomm.com',
  legal: 'legal@gesicomm.com',
  comercial: 'support@gesicomm.com',
  seguridad: 'security@gesicomm.com',
};

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
      derivado_a: CASILLAS[registro.area] || CASILLAS.soporte,
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
module.exports.CASILLAS = CASILLAS;
