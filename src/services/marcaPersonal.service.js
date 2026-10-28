'use strict';
const { createClient, MarcaPersonalError } = require('./marcaPersonal.client');

function configured() {
  return process.env.MARCA_PERSONAL_SSO_ENABLED === 'true'
    && !!process.env.MARCA_PERSONAL_SUPABASE_SERVICE_ROLE_KEY;
}
function remote() {
  if (!configured()) throw new MarcaPersonalError('Marca Personal está temporalmente en mantenimiento.');
  return createClient({ url: process.env.MARCA_PERSONAL_SUPABASE_URL, key: process.env.MARCA_PERSONAL_SUPABASE_SERVICE_ROLE_KEY });
}
async function identity(id) {
  const { Usuario, Rol } = require('../models');
  const user = await Usuario.findByPk(id, { include: [{ model: Rol }],
    attributes: ['id','nombre','correo_electronico','activo','email_verificado','rol_id'] });
  if (!user) return null;
  const subscription = await require('./suscripcion.service').suscripcionActivaDeUsuario(user.id);
  // Permisos administrativos de Gesicom nunca se trasladan a administración de T2E.
  const enabled = user.activo && user.email_verificado
    && (user.Rol?.nombre === 'administrador' || (subscription?.Plan?.equivale_plan === 'pago' && require('../utils/rutasPlan').rutasDeSuscripcion(subscription).personal));
  return { id: Number(user.id), nombre: user.nombre, email: user.correo_electronico, enabled: Boolean(enabled) };
}
async function provisionUser(id) {
  const user = await identity(id);
  const client = remote();
  if (!user) { await client.disable(id); return null; }
  return client.provision(user);
}
async function openSession(id) {
  const user = await identity(id);
  if (!user) throw new MarcaPersonalError('Usuario no encontrado.', 401);
  const client = remote();
  const link = await client.provision(user);
  if (!user.enabled) throw new MarcaPersonalError('Necesitás verificar tu correo y tener una suscripción activa de Gesicom.', 403);
  return { user_id: link.supabase_user_id, account_id: link.account_id,
    session: await client.session(user.id, link.supabase_user_id) };
}
async function status(id) {
  const user = await identity(id);
  if (!user || !user.enabled) {
    await remote().disable(id);
    throw new MarcaPersonalError('Tu acceso de Gesicom no está activo.', 403);
  }
  const link = await remote().getLink(id);
  return { user_id: link?.supabase_user_id || null, account_id: link?.account_id || null };
}
module.exports = { configured, remote, identity, provisionUser, openSession, status };
