'use strict';

const { Tienda, Usuario } = require('../models');
const { idsDeAdministradores, notificarEnApp } = require('../services/notificaciones/pedidosNotificaciones.service');
const { envolverControlador } = require('../utils/asyncHandler');

function validarUrlProducto(value) {
  const url = String(value || '').trim();
  if (!url) {
    const error = new Error('Pegá el link del producto que querés importar.');
    error.status = 400;
    throw error;
  }
  if (url.length > 2000) {
    const error = new Error('El link es demasiado largo.');
    error.status = 400;
    throw error;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    const error = new Error('El link del producto no parece válido.');
    error.status = 400;
    throw error;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const error = new Error('El link debe empezar con http:// o https://.');
    error.status = 400;
    throw error;
  }

  return parsed.toString();
}

async function solicitar(req, res) {
  const productoUrl = validarUrlProducto(req.body?.producto_url || req.body?.url);
  const usuario = await Usuario.findByPk(req.usuario.id, {
    attributes: ['id', 'nombre', 'correo_electronico', 'inquilino_id'],
  });
  if (!usuario) {
    const error = new Error('No se encontró el usuario autenticado.');
    error.status = 404;
    throw error;
  }

  const inquilinoId = usuario.inquilino_id || req.usuario.tenantId;
  if (!inquilinoId) {
    const error = new Error('No se pudo identificar el inquilino de la cuenta.');
    error.status = 409;
    throw error;
  }

  const adminIds = await idsDeAdministradores(inquilinoId);
  if (!adminIds.length) {
    const error = new Error('No hay un administrador configurado para recibir la solicitud.');
    error.status = 409;
    throw error;
  }

  const tienda = req.usuario.tiendaId
    ? await Tienda.findByPk(req.usuario.tiendaId, { attributes: ['nombre'] })
    : await Tienda.findOne({ where: { usuario_id: req.usuario.id }, attributes: ['nombre'] });

  const tiendaNombre = tienda?.nombre || 'Tienda sin nombre';
  const usuarioNombre = usuario.nombre || req.usuario.nombre || usuario.correo_electronico || req.usuario.email || `Usuario #${req.usuario.id}`;

  await notificarEnApp(adminIds, {
    tipo: 'IMPORTADA_CHINA_SOLICITUD',
    entidad_tipo: 'importada_china_solicitud',
    entidad_id: null,
    envio_id: null,
    titulo: 'Nuevo producto para importar de China',
    mensaje: `${tiendaNombre} (${usuarioNombre}) envió este link: ${productoUrl}`,
  });

  res.status(201).json({ ok: true });
}

module.exports = {
  solicitar,
};

envolverControlador(module.exports);
