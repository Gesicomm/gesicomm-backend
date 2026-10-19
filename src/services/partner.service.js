const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const PartnerSolicitud = require('../models/PartnerSolicitud');
const { Usuario } = require('../models');
const { idsDeAdministradores, notificarEnApp } = require('./notificaciones/pedidosNotificaciones.service');
const { logger } = require('../utils/logger');

const terminos = {
  version: '1.0',
  fecha: '2026-10-14',
  texto: fs.readFileSync(path.join(__dirname, '../data/partner-terminos-v1.txt'), 'utf8'),
};
const esquema = z.object({
  nombre: z.string().trim().min(2).max(150),
  telefono: z.string().trim().min(6).max(50),
  acepta_terminos: z.literal(true),
  terminos_version: z.literal(terminos.version),
}).strict();

function serializar(solicitud) {
  if (!solicitud) return null;
  return {
    id: solicitud.id, nombre: solicitud.nombre, telefono: solicitud.telefono,
    estado: solicitud.estado, terminos_version: solicitud.terminos_version,
    terminos_aceptados_en: solicitud.terminos_aceptados_en, created_at: solicitud.created_at,
  };
}

async function obtener(usuarioId) {
  const [solicitud, usuario] = await Promise.all([
    PartnerSolicitud.findOne({ where: { usuario_id: usuarioId } }),
    Usuario.findByPk(usuarioId, { attributes: ['nombre'] }),
  ]);
  return { solicitud: serializar(solicitud), nombre: usuario?.nombre || '', terminos };
}

async function solicitar(usuarioId, datos) {
  const validacion = esquema.safeParse(datos);
  if (!validacion.success) throw Object.assign(new Error('Completá tu nombre, teléfono y aceptá los términos vigentes.'), { status: 422 });
  const usuario = await Usuario.findByPk(usuarioId);
  if (!usuario) throw Object.assign(new Error('Usuario no encontrado.'), { status: 404 });
  const { nombre, telefono } = validacion.data;
  // La restricción por usuario evita solicitudes duplicadas ante doble clic o reintentos.
  const [solicitud, creada] = await PartnerSolicitud.findOrCreate({
    where: { usuario_id: usuario.id },
    defaults: {
      usuario_id: usuario.id, nombre, telefono, email: usuario.correo_electronico,
      estado: 'pendiente', terminos_version: terminos.version, terminos_aceptados_en: new Date(),
    },
  });
  if (creada) {
    try {
      const administradores = usuario.inquilino_id ? await idsDeAdministradores(usuario.inquilino_id) : [];
      await notificarEnApp(administradores, {
        tipo: 'PARTNER_SOLICITUD', entidad_tipo: 'partner_solicitud', entidad_id: solicitud.id,
        titulo: 'Nueva solicitud de Partner Certificado',
        mensaje: nombre + ' solicitó información para ingresar al programa. Teléfono: ' + telefono + '. Correo: ' + usuario.correo_electronico,
      });
    } catch (error) {
      // La solicitud queda disponible en la bandeja aun si falla el aviso.
      logger.error({ mensaje: 'No se pudo notificar la solicitud partner.', solicitudId: solicitud.id, error: error.message });
    }
  }
  return { solicitud: serializar(solicitud), creada };
}

module.exports = { obtener, solicitar };
