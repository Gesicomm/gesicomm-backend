'use strict';
const { createHash } = require('crypto');
const { UniqueConstraintError } = require('sequelize');
const { sequelize, Tienda, Usuario, ImportacionSolicitud, Notificacion } = require('../models');
const { idsDeAdministradores } = require('../services/notificaciones/pedidosNotificaciones.service');
const { envolverControlador } = require('../utils/asyncHandler');

function errorSolicitud(message, status = 400) { return Object.assign(new Error(message), { status }); }
function validarDatos(body = {}) {
  let url;
  try { url = new URL(String(body.producto_url || '').trim()); } catch { throw errorSolicitud('Ingresá un enlace válido de Alibaba.'); }
  if (url.protocol !== 'https:' || !(url.hostname === 'alibaba.com' || url.hostname.endsWith('.alibaba.com')) || url.username || url.password || url.port || url.href.length > 2000) throw errorSolicitud('Usá un enlace HTTPS de un dominio oficial de Alibaba (alibaba.com).');
  url.hash = '';
  if (!['number', 'string'].includes(typeof body.cantidad)) throw errorSolicitud('La cantidad debe ser un número entero positivo.');
  const cantidad = Number(body.cantidad);
  if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > 2147483647) throw errorSolicitud('La cantidad debe ser un número entero positivo.');
  const transporte = body.transporte ?? 'conveniente';
  if (!['conveniente', 'aereo', 'maritimo'].includes(transporte)) throw errorSolicitud('Seleccioná un método de transporte válido.');
  if (body.observaciones != null && typeof body.observaciones !== 'string') throw errorSolicitud('Las observaciones deben ser texto.');
  const observaciones = (body.observaciones || '').trim();
  if (observaciones.length > 2000) throw errorSolicitud('Las observaciones pueden tener hasta 2000 caracteres.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.clave_idempotencia || '')) throw errorSolicitud('No se pudo identificar el envío. Recargá la página e intentá nuevamente.');
  return { producto_url: url.toString(), cantidad, transporte, observaciones };
}
function responder(res, solicitud, duplicada = false) {
  return res.status(duplicada ? 200 : 201).json({ ok: true, duplicada, solicitud: { id: solicitud.id, estado: solicitud.estado, created_at: solicitud.created_at } });
}
async function solicitar(req, res) {
  const datos = validarDatos(req.body);
  if (!req.usuario.tiendaId) throw errorSolicitud('Seleccioná la tienda para registrar tu solicitud.', 409);
  const usuario = await Usuario.findByPk(req.usuario.id, { attributes: ['id', 'nombre', 'inquilino_id'] });
  if (!usuario) throw errorSolicitud('No se encontró el usuario autenticado.', 404);
  if (!usuario.inquilino_id) throw errorSolicitud('No se pudo identificar la cuenta del usuario.', 409);
  const tienda = await Tienda.findOne({ where: { id: req.usuario.tiendaId, usuario_id: usuario.id, inquilino_id: usuario.inquilino_id }, attributes: ['id', 'nombre'] });
  if (!tienda) throw errorSolicitud('La tienda seleccionada no pertenece a tu cuenta.', 403);
  const where = { usuario_id: usuario.id, tienda_id: tienda.id, clave_idempotencia: req.body.clave_idempotencia };
  const huella = createHash('sha256').update(JSON.stringify(datos)).digest('hex');
  const responderExistente = solicitud => {
    if (solicitud.huella !== huella) throw errorSolicitud('Este envío ya fue registrado con otros datos. Iniciá una nueva solicitud.', 409);
    return responder(res, solicitud, true);
  };
  const existente = await ImportacionSolicitud.findOne({ where });
  if (existente) return responderExistente(existente);
  const adminIds = await idsDeAdministradores(usuario.inquilino_id);
  if (!adminIds.length) throw errorSolicitud('No hay un administrador configurado para recibir la solicitud.', 409);
  try {
    const solicitud = await sequelize.transaction(async transaction => {
      const nueva = await ImportacionSolicitud.create({ ...where, ...datos, inquilino_id: usuario.inquilino_id, estado: 'Pendiente de cotización', huella }, { transaction });
      const transporte = { conveniente: 'Opción más conveniente', aereo: 'Transporte aéreo', maritimo: 'Transporte marítimo' }[datos.transporte];
      await Notificacion.bulkCreate(adminIds.map(usuario_id => ({
        usuario_id, tipo: 'IMPORTADA_CHINA_SOLICITUD', entidad_tipo: 'importada_china_solicitud', entidad_id: nueva.id,
        titulo: `Presupuesto de importación #${nueva.id} · ${tienda.nombre}`,
        mensaje: `Producto: ${datos.producto_url}\nTienda: ${tienda.nombre} (${usuario.nombre || `Usuario #${usuario.id}`})\nEstado: Pendiente de cotización\nCantidad: ${datos.cantidad} unidades\nTransporte: ${transporte}\nObservaciones: ${datos.observaciones || 'Sin observaciones'}`,
      })), { transaction });
      return nueva;
    });
    return responder(res, solicitud);
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      const repetida = await ImportacionSolicitud.findOne({ where });
      if (repetida) return responderExistente(repetida);
    }
    throw err;
  }
}
async function listar(req, res) {
  if (req.usuario.rol !== 'administrador') throw errorSolicitud('Acceso reservado al administrador.', 403);
  const usuario = await Usuario.findByPk(req.usuario.id, { attributes: ['inquilino_id'] });
  if (!usuario?.inquilino_id) throw errorSolicitud('No se encontró la cuenta del administrador.', 403);
  const page = Math.max(1, Math.min(10000, parseInt(req.query.page, 10) || 1));
  const resultado = await ImportacionSolicitud.findAndCountAll({ where: { inquilino_id: usuario.inquilino_id }, order: [['created_at', 'DESC'], ['id', 'DESC']], limit: 50, offset: (page - 1) * 50 });
  res.json({ solicitudes: resultado.rows, total: resultado.count, page });
}
module.exports = { solicitar, listar };
envolverControlador(module.exports);
