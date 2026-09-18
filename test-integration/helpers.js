'use strict';

/**
 * Helpers compartidos por los specs de integración. Todo acá usa los
 * modelos REALES (`../src/models`) contra la Postgres efímera que levantó
 * globalSetup.js — nada de mocks.
 */
const {
  sequelize, Usuario, Inquilino, Plan, Suscripcion, PagoSuscripcion, AuthEvent, AuthNotification,
} = require('../src/models');

let inquilinoId;
async function getInquilinoId() {
  if (inquilinoId) return inquilinoId;
  const fila = await Inquilino.findOne({ order: [['id', 'ASC']] });
  if (!fila) throw new Error('No hay Inquilino sembrado — revisar globalSetup.js.');
  inquilinoId = fila.id;
  return inquilinoId;
}

let contador = 0;
function correoUnico(prefijo = 'test') {
  contador += 1;
  return `${prefijo}.${Date.now()}.${contador}@integracion.test`;
}

async function crearUsuarioNoVerificado({ email } = {}) {
  return Usuario.create({
    inquilino_id: await getInquilinoId(),
    nombre: 'Persona de Test',
    correo_electronico: email || correoUnico('usuario'),
    contrasena_hash: 'hash-de-prueba-no-es-una-contrasena-real',
    email_verificado: false,
  });
}

async function obtenerPlan(codigo = 'pro') {
  const plan = await Plan.findOne({ where: { codigo } });
  if (!plan) throw new Error(`Plan semilla "${codigo}" no encontrado — ¿falló migrate-planes-suscripciones.js?`);
  return plan;
}

let refContador = 0;
/** Crea una Suscripcion 'activa' + su PagoSuscripcion 'PAID' — el estado que hoy sostiene indefinidamente un pago sin cuenta. */
async function crearSuscripcionPagada({ email, planCodigo = 'pro', tokenRegistro = null, tokenExpira = null } = {}) {
  const plan = await obtenerPlan(planCodigo);
  const correo = email || correoUnico('compra');
  const suscripcion = await Suscripcion.create({
    plan_id: plan.id,
    email: correo,
    nombre: 'Comprador de Test',
    estado: 'activa',
    precio_pagado: plan.precio,
    periodo_inicio: new Date(),
    periodo_fin: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    token_registro: tokenRegistro,
    token_registro_expira: tokenExpira,
  });
  refContador += 1;
  const pago = await PagoSuscripcion.create({
    suscripcion_id: suscripcion.id,
    referencia: `IT${Date.now()}${refContador}`,
    hash_pedido: `hash_it_${Date.now()}_${refContador}`,
    estado: 'PAID',
    monto: plan.precio,
    pagado_en: new Date(),
  });
  return { suscripcion, pago, plan, email: correo };
}

module.exports = {
  sequelize, Usuario, Inquilino, Plan, Suscripcion, PagoSuscripcion, AuthEvent, AuthNotification,
  getInquilinoId, correoUnico, crearUsuarioNoVerificado, crearSuscripcionPagada, obtenerPlan,
};
