'use strict';
const { z } = require('zod');
const { sequelize, RahaSolicitud, RahaDocumento, Tienda, Usuario } = require('../../models');
const storage = require('./storage');
const { idsDeAdministradores, notificarEnApp } = require('../notificaciones/pedidosNotificaciones.service');
const { logger } = require('../../utils/logger');
const text = length => z.string().trim().max(length).default('');
const schema = z.object({
  razon_social: text(180), ruc: text(30), representante: text(180), cedula: text(30),
  email: text(150), telefono: text(30), direccion: text(300), ciudad: text(100), departamento: text(100),
  actividad_economica: text(300), tipo_productos: text(600), operaciones_mensuales: text(10),
  banco: text(100), titular_cuenta: text(180), numero_cuenta: text(80), moneda: z.enum(['PYG', 'USD']).default('PYG'),
}).strict();
const TIPOS = ['ruc', 'cedula', 'cuenta_bancaria', 'productos', 'adicional'];
const EDITABLE = ['borrador', 'observada'];
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function parse(input) {
  const result = schema.safeParse(input);
  if (!result.success) fail('Datos invalidos: revisa los campos y sus longitudes.');
  return result.data;
}
async function identity(actor) {
  const usuario = await Usuario.findByPk(actor.id, { attributes: ['id', 'inquilino_id'] });
  if (!usuario?.inquilino_id) fail('No autorizado.', 403);
  return usuario;
}
async function owned(actor, transaction) {
  const usuario = await identity(actor);
  const tienda = await Tienda.findOne({ where: { usuario_id: actor.id, inquilino_id: usuario.inquilino_id }, transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
  if (!tienda) fail('Primero debes crear tu tienda.', 404);
  const [solicitud] = await RahaSolicitud.findOrCreate({ where: { usuario_id: actor.id }, defaults: { tienda_id: tienda.id, inquilino_id: tienda.inquilino_id }, transaction });
  if (solicitud.inquilino_id !== usuario.inquilino_id) fail('No autorizado.', 403);
  if (transaction) await solicitud.reload({ transaction, lock: transaction.LOCK.UPDATE });
  return solicitud;
}
async function accessible(actor, id, transaction) {
  const usuario = await identity(actor);
  const where = { id, inquilino_id: usuario.inquilino_id };
  if (actor.rol !== 'administrador') where.usuario_id = actor.id;
  const solicitud = await RahaSolicitud.findOne({ where, transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
  if (!solicitud) fail('Solicitud no encontrada.', 404);
  if (solicitud.estado === 'borrador' && Number(solicitud.usuario_id) !== Number(actor.id)) fail('Solicitud no encontrada.', 404);
  return solicitud;
}
function admin(actor) { if (actor.rol !== 'administrador') fail('Solo administradores.', 403); }
function editable(solicitud, version) {
  if (!EDITABLE.includes(solicitud.estado)) fail('La solicitud esta en revision o finalizada y no se puede editar.', 409);
  if (!Number.isSafeInteger(version) || version !== solicitud.version) fail('La solicitud cambio. Actualiza antes de continuar.', 409);
}
async function serialize(solicitud, transaction) {
  const documentos = await RahaDocumento.findAll({ where: { solicitud_id: solicitud.id }, attributes: ['id', 'tipo', 'nombre', 'mime', 'size', 'created_at'], order: [['id', 'ASC']], transaction });
  return { ...solicitud.toJSON(), documentos };
}
async function status(actor) { return serialize(await sequelize.transaction(t => owned(actor, t))); }
async function save(actor, input) {
  const datos = parse(input.datos);
  const solicitud = await sequelize.transaction(async t => {
    const row = await owned(actor, t); editable(row, input.version);
    return row.update({ datos, version: row.version + 1 }, { transaction: t });
  });
  return serialize(solicitud);
}
async function upload(actor, tipo, version, file) {
  if (!TIPOS.includes(tipo)) fail('Tipo de documento invalido.');
  let uploaded;
  try {
    const solicitud = await sequelize.transaction(async t => {
      const row = await owned(actor, t); editable(row, Number(version));
      if (await RahaDocumento.count({ where: { solicitud_id: row.id }, transaction: t }) >= 12) fail('Maximo 12 adjuntos por solicitud.');
      uploaded = await storage.put(file);
      await RahaDocumento.create({ ...uploaded, solicitud_id: row.id, tipo }, { transaction: t });
      return row.update({ version: row.version + 1 }, { transaction: t });
    });
    return serialize(solicitud);
  } catch (error) {
    if (uploaded) await storage.remove(uploaded).catch(() => logger.error({ mensaje: 'Raha: limpiar adjunto huerfano pendiente', key: uploaded.storage_key }));
    throw error;
  }
}
async function remove(actor, id, version) {
  let doc;
  const solicitud = await sequelize.transaction(async t => {
    const row = await owned(actor, t); editable(row, version);
    doc = await RahaDocumento.findOne({ where: { id, solicitud_id: row.id }, transaction: t });
    if (!doc) fail('Documento no encontrado.', 404);
    await doc.destroy({ transaction: t });
    return row.update({ version: row.version + 1 }, { transaction: t });
  });
  await storage.remove(doc).catch(() => logger.error({ mensaje: 'Raha: limpiar adjunto eliminado pendiente', key: doc.storage_key }));
  return serialize(solicitud);
}
async function notify(row, actor, submitted) {
  const recipients = submitted ? await idsDeAdministradores(row.inquilino_id) : [row.usuario_id];
  await notificarEnApp(recipients, {
    tipo: `${submitted ? 'RAHA_SOLICITUD' : 'RAHA_REVISION'}_${row.version}`,
    entidad_tipo: submitted ? 'raha_solicitud_admin' : 'raha_solicitud', entidad_id: row.id,
    titulo: submitted ? 'Solicitud de conexion Raha' : 'Actualizacion de tu solicitud Raha',
    mensaje: `Solicitud #${row.id}: ${row.estado}.`,
  });
}
function append(row, actor, estado, extra = {}) {
  return [...row.historial, { estado, usuario_id: actor.id, ocurrido_at: new Date().toISOString(), version: row.version + 1, ...extra }];
}
async function submit(actor, input) {
  const datos = parse(input.datos);
  if (input.consentimiento !== true) fail('Debes autorizar la revision y el envio manual de tus datos a Raha.');
  for (const [field, value] of Object.entries(datos)) if (!value) fail(`Completa el campo ${field}.`);
  if (!z.string().email().safeParse(datos.email).success) fail('Email invalido.');
  if (!/^[\d+ ()-]{6,30}$/.test(datos.telefono)) fail('Telefono invalido.');
  if (!/^\d+$/.test(datos.operaciones_mensuales) || Number(datos.operaciones_mensuales) > 1000000000) fail('Indica un volumen mensual entero valido.');
  const row = await sequelize.transaction(async t => {
    const solicitud = await owned(actor, t);
    // Repeating the same submission after a lost HTTP response is harmless.
    if (solicitud.estado === 'en_revision' && input.version === solicitud.version - 1 && require('node:util').isDeepStrictEqual(datos, solicitud.datos)) return solicitud;
    editable(solicitud, input.version);
    const docs = await RahaDocumento.findAll({ where: { solicitud_id: solicitud.id }, transaction: t });
    for (const tipo of ['ruc', 'cedula']) if (!docs.some(d => d.tipo === tipo)) fail(`Adjunta el documento ${tipo === 'ruc' ? 'constancia de RUC' : 'cedula del representante legal'}.`);
    return solicitud.update({ datos, estado: 'en_revision', enviado_at: new Date(), version: solicitud.version + 1,
      historial: append(solicitud, actor, 'en_revision', { consentimiento: true, datos, documentos: docs.map(d => ({ id: d.id, tipo: d.tipo, nombre: d.nombre, sha256: d.sha256 })) }) }, { transaction: t });
  });
  await notify(row, actor, true).catch(() => logger.error({ mensaje: 'Raha: notificacion pendiente', solicitudId: row.id }));
  return serialize(row);
}
async function list(actor, { estado, offset = 0 } = {}) {
  admin(actor); const usuario = await identity(actor);
  if (estado && !['en_revision', 'observada', 'enviada_raha', 'aprobada', 'rechazada'].includes(estado)) fail('Estado invalido.');
  if (!/^\d+$/.test(String(offset)) || Number(offset) > 100000) fail('Pagina invalida.');
  const { count, rows } = await RahaSolicitud.findAndCountAll({
    where: { inquilino_id: usuario.inquilino_id, estado: estado || { [require('sequelize').Op.ne]: 'borrador' } },
    attributes: ['id', 'estado', 'enviado_at', 'updated_at', 'version'],
    include: [{ model: Tienda, as: 'tienda', attributes: ['nombre'] }],
    order: [['updated_at', 'DESC'], ['id', 'DESC']], limit: 30, offset: Number(offset),
  });
  return { total: count, solicitudes: rows };
}
async function review(actor, id, input) {
  admin(actor);
  const result = z.object({ estado: z.enum(['observada', 'enviada_raha', 'aprobada', 'rechazada']),
    nota: z.string().trim().min(5).max(1000), referencia: z.string().trim().max(180).default(''), version: z.number().int().nonnegative() }).strict().safeParse(input);
  if (!result.success) fail('Completa estado, nota (5-1000 caracteres) y version.');
  const data = result.data;
  if (['enviada_raha', 'aprobada'].includes(data.estado) && !data.referencia) fail('Registra la referencia del envio o de la aprobacion recibida de Raha.');
  const row = await sequelize.transaction(async t => {
    const solicitud = await accessible(actor, id, t);
    if (solicitud.version !== data.version) fail('La solicitud cambio. Actualiza antes de continuar.', 409);
    const allowed = solicitud.estado === 'en_revision' ? ['observada', 'enviada_raha', 'rechazada'] : solicitud.estado === 'enviada_raha' ? ['observada', 'aprobada', 'rechazada'] : [];
    if (!allowed.includes(data.estado)) fail('Transicion de revision invalida.', 409);
    return solicitud.update({ estado: data.estado, version: solicitud.version + 1,
      historial: append(solicitud, actor, data.estado, { nota: data.nota, referencia: data.referencia }) }, { transaction: t });
  });
  await notify(row, actor, false).catch(() => logger.error({ mensaje: 'Raha: notificacion pendiente', solicitudId: row.id }));
  return serialize(row);
}
async function document(actor, id) {
  const doc = await RahaDocumento.findByPk(id);
  if (!doc) fail('Documento no encontrado.', 404);
  await accessible(actor, doc.solicitud_id);
  return { doc, buffer: await storage.read(doc) };
}
async function detail(actor, id) { admin(actor); return serialize(await accessible(actor, id)); }
async function dossier(actor, id) {
  admin(actor);
  return sequelize.transaction(async t => {
    const row = await accessible(actor, id, t);
    if (row.estado === 'borrador') fail('La solicitud todavia no fue enviada.', 409);
    const snapshot = await serialize(row, t);
    const docs = await RahaDocumento.findAll({ where: { solicitud_id: row.id }, order: [['id', 'ASC']], transaction: t });
    // Freeze one version until every attachment is copied, before sending headers.
    const archivos = await Promise.all(docs.map(async doc => ({ nombre: `${doc.tipo}/${doc.id}-${doc.nombre}`, buffer: await storage.read(doc) })));
    return { snapshot, archivos };
  });
}
module.exports = { status, save, upload, remove, submit, list, review, document, detail, dossier, parse };
