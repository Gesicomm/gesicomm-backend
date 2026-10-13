'use strict';
const { z } = require('zod');
const { sequelize, RahaSolicitud, RahaDocumento, RahaPortalUsuario, Tienda, Usuario } = require('../../models');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
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
const TIPOS = ['ruc', 'cedula'];
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
  let uploaded, reemplazados = [];
  try {
    const solicitud = await sequelize.transaction(async t => {
      const row = await owned(actor, t); editable(row, Number(version));
      uploaded = await storage.put(file);
      // Un archivo por tipo: el nuevo reemplaza al anterior.
      reemplazados = await RahaDocumento.findAll({ where: { solicitud_id: row.id, tipo }, transaction: t });
      for (const doc of reemplazados) await doc.destroy({ transaction: t });
      await RahaDocumento.create({ ...uploaded, solicitud_id: row.id, tipo }, { transaction: t });
      return row.update({ version: row.version + 1 }, { transaction: t });
    });
    for (const doc of reemplazados) await storage.remove(doc).catch(() => logger.error({ mensaje: 'Raha: limpiar adjunto reemplazado pendiente', key: doc.storage_key }));
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
    mensaje: `Solicitud #${row.id}: ${{ enviada_raha: 'enviada a Raha', en_revision: 'en revision', observada: 'Raha pidio correcciones', aprobada: 'aprobada por Raha', rechazada: 'rechazada por Raha' }[row.estado] || row.estado}.`,
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
    if (solicitud.estado === 'enviada_raha' && input.version === solicitud.version - 1 && require('node:util').isDeepStrictEqual(datos, solicitud.datos)) return solicitud;
    editable(solicitud, input.version);
    const docs = await RahaDocumento.findAll({ where: { solicitud_id: solicitud.id }, transaction: t });
    for (const tipo of ['ruc', 'cedula']) if (!docs.some(d => d.tipo === tipo)) fail(`Adjunta el documento ${tipo === 'ruc' ? 'constancia de RUC' : 'cedula del representante legal'}.`);
    // Al enviar, la solicitud queda visible directamente en el portal de Raha.
    return solicitud.update({ datos, estado: 'enviada_raha', enviado_at: new Date(), version: solicitud.version + 1,
      historial: append(solicitud, actor, 'enviada_raha', { consentimiento: true, datos, documentos: docs.map(d => ({ id: d.id, tipo: d.tipo, nombre: d.nombre, sha256: d.sha256 })) }) }, { transaction: t });
  });
  await notify(row, actor, true).catch(() => logger.error({ mensaje: 'Raha: notificacion pendiente', solicitudId: row.id }));
  return serialize(row);
}
function normalizarRangoFechas({ rango_fecha, fecha_desde, fecha_hasta } = {}) {
  const ahora = new Date();
  const aIsoAsuncion = d => d.toLocaleDateString('sv-SE', { timeZone: 'America/Asuncion' });

  let desdeStr = fecha_desde ? String(fecha_desde).trim().slice(0, 10) : '';
  let hastaStr = fecha_hasta ? String(fecha_hasta).trim().slice(0, 10) : '';

  if (rango_fecha === 'hoy') {
    const hoy = aIsoAsuncion(ahora);
    desdeStr = hoy;
    hastaStr = hoy;
  } else if (rango_fecha === 'ayer') {
    const ayerD = new Date(ahora);
    ayerD.setDate(ayerD.getDate() - 1);
    const ayer = aIsoAsuncion(ayerD);
    desdeStr = ayer;
    hastaStr = ayer;
  } else if (rango_fecha === '7d') {
    const inicio = new Date(ahora);
    inicio.setDate(inicio.getDate() - 6);
    desdeStr = aIsoAsuncion(inicio);
    hastaStr = aIsoAsuncion(ahora);
  } else if (rango_fecha === '30d') {
    const inicio = new Date(ahora);
    inicio.setDate(inicio.getDate() - 29);
    desdeStr = aIsoAsuncion(inicio);
    hastaStr = aIsoAsuncion(ahora);
  } else if (rango_fecha === 'mes') {
    const hoy = aIsoAsuncion(ahora);
    desdeStr = `${hoy.slice(0, 7)}-01`;
    hastaStr = hoy;
  }

  if (desdeStr && !hastaStr) hastaStr = desdeStr;
  else if (!desdeStr && hastaStr) desdeStr = hastaStr;

  if (!desdeStr && !hastaStr) return null;

  const dInicio = new Date(`${desdeStr}T00:00:00.000-03:00`);
  const dFin = new Date(`${hastaStr}T23:59:59.999-03:00`);
  if (isNaN(dInicio.getTime()) || isNaN(dFin.getTime())) return null;

  return {
    fecha_desde: desdeStr,
    fecha_hasta: hastaStr,
    inicio: dInicio,
    fin: dFin,
  };
}

async function list(actor, input = {}) {
  admin(actor); const usuario = await identity(actor);
  const { estado, offset, page = 1, limit = 20, rango_fecha = '', fecha_desde = '', fecha_hasta = '' } = input;
  if (estado && !['en_revision', 'observada', 'enviada_raha', 'aprobada', 'rechazada'].includes(estado)) fail('Estado invalido.');
  const computedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  let computedOffset = 0;
  if (offset !== undefined && offset !== null && offset !== '') {
    computedOffset = Math.max(0, Number(offset) || 0);
  } else if (page !== undefined && page !== null && page !== '') {
    computedOffset = (Math.max(1, Number(page) || 1) - 1) * computedLimit;
  }
  if (!/^\d+$/.test(String(computedOffset)) || computedOffset > 100000) fail('Pagina invalida.');

  const rango = normalizarRangoFechas({ rango_fecha, fecha_desde, fecha_hasta });
  const where = { inquilino_id: usuario.inquilino_id, estado: estado || { [require('sequelize').Op.ne]: 'borrador' } };

  if (rango?.inicio && rango?.fin) {
    where[Op.and] = [
      ...(where[Op.and] || []),
      sequelize.where(
        sequelize.fn('COALESCE', sequelize.col('RahaSolicitud.enviado_at'), sequelize.col('RahaSolicitud.created_at')),
        { [Op.between]: [rango.inicio, rango.fin] }
      ),
    ];
  }

  const { count, rows } = await RahaSolicitud.findAndCountAll({
    where,
    attributes: ['id', 'estado', 'enviado_at', 'updated_at', 'version'],
    include: [{ model: Tienda, as: 'tienda', attributes: ['nombre'] }],
    order: [['updated_at', 'DESC'], ['id', 'DESC']],
    limit: computedLimit,
    offset: computedOffset,
  });

  return {
    total: count,
    page: Math.floor(computedOffset / computedLimit) + 1,
    limit: computedLimit,
    totalPaginas: Math.ceil(count / computedLimit) || 1,
    rango: rango ? { fecha_desde: rango.fecha_desde, fecha_hasta: rango.fecha_hasta, rango_fecha: rango_fecha || 'custom' } : null,
    solicitudes: rows,
  };
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
// ─────────────────────────────────────────────────────────────
// Portal externo de Raha (/raha/login)
// Raha ve todas las solicitudes ya enviadas (no los borradores) y registra
// la aceptacion, el rechazo o el pedido de correcciones.
// ─────────────────────────────────────────────────────────────
const PENDIENTES = ['en_revision', 'enviada_raha'];
const FILTROS_PORTAL = { pendiente: PENDIENTES, observada: ['observada'], aprobada: ['aprobada'], rechazada: ['rechazada'] };
function portalJwtSecret() {
  const secret = process.env.RAHA_PORTAL_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) fail('Portal Raha no configurado.', 503);
  return secret;
}
function portalUsuarioPublico(u) { return { id: u.id, nombre: u.nombre, email: u.email, activo: u.activo, ultimo_acceso: u.ultimo_acceso, created_at: u.created_at }; }
let hashFalso;
async function portalLogin(input = {}) {
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  if (!email || !password) fail('Email y contrasena son obligatorios.');
  const usuario = await RahaPortalUsuario.findOne({ where: { email } });
  // Comparar siempre para no revelar por tiempo si el email existe.
  if (!hashFalso) hashFalso = await bcrypt.hash('cuenta-inexistente', 10);
  const ok = await bcrypt.compare(password, usuario?.password_hash || hashFalso);
  if (!usuario || !usuario.activo || !ok) fail('Credenciales invalidas.', 401);
  await usuario.update({ ultimo_acceso: new Date() });
  const token = jwt.sign({ tipo: 'raha_portal', uid: usuario.id }, portalJwtSecret(), { expiresIn: '12h' });
  return { token, usuario: portalUsuarioPublico(usuario) };
}
async function portalVerify(token) {
  let payload;
  try { payload = jwt.verify(token, portalJwtSecret()); } catch { fail('Sesion invalida o vencida.', 401); }
  if (payload?.tipo !== 'raha_portal' || !Number.isSafeInteger(payload.uid)) fail('Sesion invalida o vencida.', 401);
  const usuario = await RahaPortalUsuario.findByPk(payload.uid);
  if (!usuario?.activo) fail('Acceso desactivado.', 401);
  return portalUsuarioPublico(usuario);
}
async function portalFind(id, transaction) {
  const solicitud = await RahaSolicitud.findOne({ where: { id, estado: { [Op.ne]: 'borrador' } }, transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
  if (!solicitud) fail('Solicitud no encontrada.', 404);
  return solicitud;
}
async function portalList(input = {}) {
  const {
    estado = '',
    buscar = '',
    offset,
    page = 1,
    limit = 20,
    rango_fecha = '',
    fecha_desde = '',
    fecha_hasta = '',
  } = input;
  if (estado && !FILTROS_PORTAL[estado]) fail('Estado invalido.');
  const computedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  let computedOffset = 0;
  if (offset !== undefined && offset !== null && offset !== '') {
    computedOffset = Math.max(0, Number(offset) || 0);
  } else if (page !== undefined && page !== null && page !== '') {
    computedOffset = (Math.max(1, Number(page) || 1) - 1) * computedLimit;
  }
  if (!/^\d+$/.test(String(computedOffset)) || computedOffset > 100000) fail('Pagina invalida.');

  const rango = normalizarRangoFechas({ rango_fecha, fecha_desde, fecha_hasta });
  const where = { estado: estado ? { [Op.in]: FILTROS_PORTAL[estado] } : { [Op.ne]: 'borrador' } };
  const q = String(buscar || '').trim().slice(0, 100).replace(/[\\%_]/g, c => `\\${c}`);
  if (q) where[Op.or] = [
    { '$tienda.nombre$': { [Op.iLike]: `%${q}%` } },
    sequelize.where(sequelize.literal(`"RahaSolicitud"."datos"->>'razon_social'`), { [Op.iLike]: `%${q}%` }),
    sequelize.where(sequelize.literal(`"RahaSolicitud"."datos"->>'ruc'`), { [Op.iLike]: `%${q}%` }),
  ];

  if (rango?.inicio && rango?.fin) {
    where[Op.and] = [
      ...(where[Op.and] || []),
      sequelize.where(
        sequelize.fn('COALESCE', sequelize.col('RahaSolicitud.enviado_at'), sequelize.col('RahaSolicitud.created_at')),
        { [Op.between]: [rango.inicio, rango.fin] }
      ),
    ];
  }

  const { count, rows } = await RahaSolicitud.findAndCountAll({
    where, attributes: ['id', 'estado', 'datos', 'enviado_at', 'updated_at'],
    include: [{ model: Tienda, as: 'tienda', attributes: ['nombre'] }],
    order: [['enviado_at', 'DESC'], ['id', 'DESC']], limit: computedLimit, offset: computedOffset, subQuery: false,
  });

  const conteoWhere = { estado: { [Op.ne]: 'borrador' } };
  if (rango?.inicio && rango?.fin) {
    conteoWhere[Op.and] = [
      sequelize.where(
        sequelize.fn('COALESCE', sequelize.col('RahaSolicitud.enviado_at'), sequelize.col('RahaSolicitud.created_at')),
        { [Op.between]: [rango.inicio, rango.fin] }
      ),
    ];
  }

  const conteo = await RahaSolicitud.findAll({
    where: conteoWhere,
    attributes: ['estado', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
    group: ['estado'],
    raw: true,
  });

  const resumen = { pendiente: 0, observada: 0, aprobada: 0, rechazada: 0 };
  for (const c of conteo) resumen[PENDIENTES.includes(c.estado) ? 'pendiente' : c.estado] = (resumen[PENDIENTES.includes(c.estado) ? 'pendiente' : c.estado] || 0) + Number(c.total);

  return {
    total: count,
    page: Math.floor(computedOffset / computedLimit) + 1,
    limit: computedLimit,
    totalPaginas: Math.ceil(count / computedLimit) || 1,
    resumen,
    rango: rango ? { fecha_desde: rango.fecha_desde, fecha_hasta: rango.fecha_hasta, rango_fecha: rango_fecha || 'custom' } : null,
    solicitudes: rows.map(r => ({
      id: r.id,
      estado: r.estado,
      enviado_at: r.enviado_at,
      updated_at: r.updated_at,
      tienda: r.tienda?.nombre || '',
      razon_social: r.datos?.razon_social || '',
      ruc: r.datos?.ruc || '',
    })),
  };
}
async function portalDetail(id) {
  const row = await portalFind(id);
  const tienda = await Tienda.findByPk(row.tienda_id, { attributes: ['nombre'] });
  return { ...(await serialize(row)), tienda: tienda ? { nombre: tienda.nombre } : null };
}
async function portalDocument(id, docId) {
  await portalFind(id);
  const doc = await RahaDocumento.findOne({ where: { id: docId, solicitud_id: id } });
  if (!doc) fail('Documento no encontrado.', 404);
  return { doc, buffer: await storage.read(doc) };
}
async function portalDossier(id) {
  return sequelize.transaction(async t => {
    const row = await portalFind(id, t);
    const snapshot = await serialize(row, t);
    const docs = await RahaDocumento.findAll({ where: { solicitud_id: row.id }, order: [['id', 'ASC']], transaction: t });
    const archivos = await Promise.all(docs.map(async doc => ({ nombre: `${doc.tipo}/${doc.id}-${doc.nombre}`, buffer: await storage.read(doc) })));
    return { snapshot, archivos };
  });
}
async function portalResolve(portalUsuario, id, input) {
  const result = z.object({ estado: z.enum(['aprobada', 'rechazada', 'observada']), nota: z.string().trim().max(1000).default(''),
    version: z.number().int().nonnegative() }).strict().safeParse(input);
  if (!result.success) fail('Datos invalidos.');
  const data = result.data;
  if (data.estado !== 'aprobada' && data.nota.length < 5) fail('Indica el motivo (minimo 5 caracteres) para que el comercio sepa que corregir.');
  const row = await sequelize.transaction(async t => {
    const solicitud = await portalFind(id, t);
    if (solicitud.version !== data.version) fail('La solicitud cambio. Actualiza antes de continuar.', 409);
    if (!PENDIENTES.includes(solicitud.estado)) fail('Esta solicitud ya fue resuelta.', 409);
    return solicitud.update({ estado: data.estado, version: solicitud.version + 1,
      historial: append(solicitud, { id: null }, data.estado, { nota: data.nota, raha_portal_usuario_id: portalUsuario.id, autor: `Raha - ${portalUsuario.nombre}` }) }, { transaction: t });
  });
  await notify(row, null, false).catch(() => logger.error({ mensaje: 'Raha: notificacion pendiente', solicitudId: row.id }));
  return portalDetail(row.id);
}
// Gestion de cuentas del portal (solo administradores de Gesicom).
const cuentaSchema = z.object({ nombre: z.string().trim().min(2).max(150), email: z.string().trim().toLowerCase().email().max(150), password: z.string().min(10).max(100) }).strict();
async function listPortalUsers(actor) {
  admin(actor);
  return (await RahaPortalUsuario.findAll({ order: [['id', 'ASC']] })).map(portalUsuarioPublico);
}
async function createPortalUser(actor, input) {
  admin(actor);
  const result = cuentaSchema.safeParse(input);
  if (!result.success) fail('Completa nombre, email valido y una contrasena de al menos 10 caracteres.');
  const { nombre, email, password } = result.data;
  if (await RahaPortalUsuario.findOne({ where: { email } })) fail('Ya existe una cuenta con ese email.', 409);
  const usuario = await RahaPortalUsuario.create({ nombre, email, password_hash: await bcrypt.hash(password, 10), activo: true });
  return portalUsuarioPublico(usuario);
}
async function updatePortalUser(actor, id, input) {
  admin(actor);
  const result = z.object({ activo: z.boolean().optional(), password: z.string().min(10).max(100).optional(), nombre: z.string().trim().min(2).max(150).optional() }).strict().safeParse(input);
  if (!result.success) fail('Datos invalidos. La contrasena debe tener al menos 10 caracteres.');
  const usuario = await RahaPortalUsuario.findByPk(id);
  if (!usuario) fail('Cuenta no encontrada.', 404);
  const { password, ...resto } = result.data;
  await usuario.update({ ...resto, ...(password ? { password_hash: await bcrypt.hash(password, 10) } : {}) });
  return portalUsuarioPublico(usuario);
}
module.exports = { status, save, upload, remove, submit, list, review, document, detail, dossier, parse,
  portalLogin, portalVerify, portalList, portalDetail, portalDocument, portalDossier, portalResolve,
  listPortalUsers, createPortalUser, updatePortalUser };
