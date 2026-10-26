'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { sequelize, Usuario, Rol, Tienda } = require('../models');
const Miembro = require('../models/TiendaMiembro');

const MODULOS = require('./modulosAcceso.json');
function error(status, message) { return Object.assign(new Error(message), { status }); }
function validarPermisos(permisos) {
  if (!permisos || typeof permisos !== 'object' || Array.isArray(permisos)) throw error(400, 'Seleccioná los permisos.');
  const normalizados = {};
  for (const [clave, valor] of Object.entries(permisos)) {
    const modulo = MODULOS.find(m => m.clave === clave);
    if (!modulo || !['ver', 'gestionar'].includes(valor) || (!modulo.gestionable && valor !== 'ver')) throw error(400, 'Permiso inválido.');
    normalizados[clave] = valor;
  }
  if (!Object.keys(normalizados).length) throw error(400, 'Seleccioná al menos una sección.');
  return normalizados;
}
const hash = token => crypto.createHash('sha256').update(token).digest('hex');
async function listarTiendas(usuarioId) {
  const membresias = await Miembro.findAll({ where: { usuario_id: usuarioId, estado: 'activo' }, attributes: ['tienda_id'] });
  return Tienda.findAll({ where: { [Op.or]: [{ usuario_id: usuarioId }, { id: membresias.map(m => m.tienda_id) }] },
    attributes: ['id', 'nombre', 'subdominio', 'logo_imagen', 'activo', 'usuario_id'], order: [['id', 'ASC']] });
}
async function propietario(usuario, transaction) {
  const tienda = await Tienda.findOne({ where: { id: usuario.tiendaId, usuario_id: usuario.id }, transaction });
  if (!tienda || usuario.rol === 'colaborador') throw error(403, 'Solo el propietario puede administrar personas de esta tienda.');
  return tienda;
}
async function listar(usuario) {
  const tienda = await propietario(usuario);
  const miembros = await Miembro.findAll({ where: { tienda_id: tienda.id }, order: [['id', 'ASC']] });
  const personas = await Usuario.findAll({ where: { id: miembros.map(m => m.usuario_id) }, attributes: ['id', 'nombre', 'correo_electronico'] });
  return { modulos: MODULOS, tienda: { id: tienda.id, nombre: tienda.nombre }, personas: miembros.map(m => ({
    id: m.id, estado: m.estado, permisos: m.permisos, expira: m.token_expira,
    nombre: personas.find(p => p.id === m.usuario_id)?.nombre,
    email: personas.find(p => p.id === m.usuario_id)?.correo_electronico,
  })) };
}
async function crear(usuario, datos) {
  const permisos = validarPermisos(datos.permisos);
  const nombre = String(datos.nombre || '').trim();
  const email = String(datos.email || '').trim().toLowerCase();
  const password = datos.password;
  if (!nombre || nombre.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw error(400, 'Indicá nombre y correo válidos.');
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) throw error(400, 'La contraseña debe tener al menos 8 caracteres, una mayúscula y un número, y no superar 72 bytes.');
  return sequelize.transaction(async transaction => {
    const tienda = await propietario(usuario, transaction);
    const rol = await Rol.findOne({ where: { nombre: 'colaborador' }, transaction });
    if (!rol) throw error(503, 'Falta aplicar la migración de personas y permisos.');
    const existente = await Usuario.findOne({ where: { correo_electronico: { [Op.iLike]: email } }, transaction });
    if (existente) throw error(409, 'Este correo ya tiene una cuenta. Usá otro correo para crear una persona nueva; si ya figura en esta tienda, editá o restablecé su acceso.');
    const persona = await Usuario.create({ nombre, correo_electronico: email, rol_id: rol.id,
      inquilino_id: tienda.inquilino_id || usuario.tenantId, email_verificado: true, activo: true,
      contrasena_hash: await bcrypt.hash(password, 12) }, { transaction });
    const miembro = await Miembro.create({ tienda_id: tienda.id, usuario_id: persona.id, estado: 'activo',
      permisos, invitado_por: usuario.id, token_hash: null, token_expira: null }, { transaction });
    return { id: miembro.id, message: 'Cuenta creada. La persona ya puede ingresar con el correo y la contraseña que definiste.' };
  });
}
async function invitar(usuario, datos) {
  const permisos = validarPermisos(datos.permisos);
  const nombre = String(datos.nombre || '').trim();
  const email = String(datos.email || '').trim().toLowerCase();
  if (!nombre || nombre.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw error(400, 'Indicá nombre y correo válidos.');
  const token = crypto.randomBytes(32).toString('hex');
  await sequelize.transaction(async transaction => {
    const tienda = await propietario(usuario, transaction);
    const rol = await Rol.findOne({ where: { nombre: 'colaborador' }, transaction });
    if (!rol) throw error(503, 'Falta aplicar la migración de personas y permisos.');
    let persona = await Usuario.findOne({ where: { correo_electronico: { [Op.iLike]: email } }, transaction });
    if (persona && persona.rol_id !== rol.id) throw error(409, 'Este correo ya pertenece a una cuenta de propietario o administrador. Usá otro correo para el colaborador.');
    if (!persona) persona = await Usuario.create({ nombre, correo_electronico: email, rol_id: rol.id,
      inquilino_id: tienda.inquilino_id || usuario.tenantId, email_verificado: false,
      contrasena_hash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12) }, { transaction });
    const [miembro] = await Miembro.findOrCreate({ where: { tienda_id: tienda.id, usuario_id: persona.id },
      defaults: { invitado_por: usuario.id, permisos }, transaction });
    if (miembro.estado === 'activo') throw error(409, 'Esta persona ya tiene acceso. Editá sus permisos.');
    await miembro.update({ permisos, estado: 'pendiente', invitado_por: usuario.id, token_hash: hash(token),
      token_expira: new Date(Date.now() + 72 * 3600000) }, { transaction });
  });
  return { token, message: 'Invitación creada. Compartí el enlace con la persona; vence en 72 horas.' };
}
async function actualizar(usuario, id, datos) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw error(400, 'Indicá una persona válida.');
  await propietario(usuario);
  const miembro = await Miembro.findOne({ where: { id, tienda_id: usuario.tiendaId } });
  if (!miembro) throw error(404, 'Persona no encontrada.');
  if (datos.estado === 'revocado') {
    await miembro.update({ estado: 'revocado', token_hash: null, token_expira: null });
  } else if (datos.estado === 'activo') {
    const persona = await Usuario.findByPk(miembro.usuario_id);
    if (!persona?.email_verificado) throw error(409, 'Esta cuenta todavía no terminó su alta.');
    await miembro.update({ estado: 'activo', permisos: validarPermisos(datos.permisos), token_hash: null, token_expira: null });
  } else {
    if (miembro.estado === 'revocado') throw error(409, 'Restablecé el acceso para volver a habilitar a esta persona.');
    await miembro.update({ permisos: validarPermisos(datos.permisos) });
  }
  return { message: 'Acceso actualizado.' };
}
async function invitacion(token, transaction) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw error(400, 'Invitación inválida o vencida.');
  const miembro = await Miembro.findOne({ where: { token_hash: hash(token), estado: 'pendiente', token_expira: { [Op.gt]: new Date() } },
    transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
  if (!miembro) throw error(400, 'Invitación inválida o vencida. Pedí un nuevo enlace.');
  return miembro;
}
async function consultar(token) {
  const miembro = await invitacion(token);
  const persona = await Usuario.findByPk(miembro.usuario_id);
  const tienda = await Tienda.findByPk(miembro.tienda_id);
  return { nombre: persona.nombre, email: persona.correo_electronico, tienda: tienda.nombre,
    existente: persona.email_verificado, permisos: miembro.permisos, modulos: MODULOS };
}
async function aceptar(token, password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 72 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) throw error(400, 'Usá entre 8 y 72 caracteres, una mayúscula y un número.');
  return sequelize.transaction(async transaction => {
    const miembro = await invitacion(token, transaction);
    const persona = await Usuario.findByPk(miembro.usuario_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (persona.email_verificado) {
      if (!await bcrypt.compare(password, persona.contrasena_hash)) throw error(400, 'La contraseña de tu cuenta no coincide.');
    } else {
      await persona.update({ contrasena_hash: await bcrypt.hash(password, 12), email_verificado: true }, { transaction });
    }
    await miembro.update({ estado: 'activo', token_hash: null, token_expira: null }, { transaction });
    return { message: 'Acceso activado. Ya podés iniciar sesión con tu correo y contraseña.' };
  });
}
module.exports = { MODULOS, validarPermisos, listarTiendas, listar, crear, invitar, actualizar, consultar, aceptar };
