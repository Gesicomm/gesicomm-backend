const crypto = require('crypto');
const { accesoDelPlan, resolverRuta } = require('../utils/rutasPlan');
const { CodigoPrueba, Plan, Suscripcion } = require('../models');
const error = message => Object.assign(new Error(message), { status: 400 });
const { enviarCodigoAcceso } = require('./notificaciones/codigoAcceso.service');
const {Op}=require('sequelize');
const {CODIGOS}=require('../utils/catalogoPlanes');

class CodigoPruebaService {
  static async listar() {
    const [codigos, planes] = await Promise.all([
      CodigoPrueba.findAll({ order: [['id', 'DESC']], limit: 100 }),
      Plan.findAll({ where: { activo: true, equivale_plan: 'pago',codigo:{[Op.in]:CODIGOS} }, order: [['orden', 'ASC']] }),
    ]);
    return { codigos, planes: planes.map(p => ({ id: p.id, nombre: p.nombre, acceso_rutas: accesoDelPlan(p) })) };
  }

  static async crear(datos, adminId) {
    const plan = await Plan.findOne({ where: { id: datos.plan_id, activo: true, equivale_plan: 'pago' } });
    if (!plan) throw error('Elegí un plan activo para la prueba.');
    if (!Number.isInteger(datos.dias) || datos.dias < 1 || datos.dias > 365) throw error('La duración debe ser de 1 a 365 días.');
    if (datos.vence_en && (!Number.isFinite(new Date(datos.vence_en).getTime()) || new Date(datos.vence_en) <= new Date())) throw error('La fecha límite para usar el código debe ser futura.');
    const codigo = await CodigoPrueba.create({
      codigo: `GESI-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
      dias: datos.dias, plan_id: plan.id, creado_por: adminId,
      ruta_acceso: resolverRuta(plan, datos.ruta_acceso),
      email: datos.email?.trim().toLowerCase() || null,
      vence_en: datos.vence_en || null, activo: true,
    });
    // El código queda guardado aunque el proveedor de correo no responda.
    const correo = await enviarCodigoAcceso(codigo, plan);
    return { ...(codigo.toJSON ? codigo.toJSON() : codigo), ...correo };
  }

  static async enviarCorreo(id) {
    const codigo = await CodigoPrueba.findByPk(id);
    if (!codigo || !codigo.email) throw error('El código no tiene un destinatario asignado.');
    if (!codigo.activo || codigo.usado_en || (codigo.vence_en && new Date(codigo.vence_en) <= new Date())) throw error('Solo se pueden enviar códigos disponibles para canjear.');
    const plan = await Plan.findOne({where:{id:codigo.plan_id,activo:true,equivale_plan:'pago'}});
    if (!plan) throw error('El plan de este código ya no está disponible.');
    return enviarCodigoAcceso(codigo, plan);
  }

  static async desactivar(id) {
    const codigo = await CodigoPrueba.findByPk(id);
    if (!codigo) throw error('Código no encontrado.');
    await codigo.update({ activo: false });
    return { message: 'Código desactivado. Las pruebas ya activadas conservan su duración.' };
  }

  // Siempre dentro de la transacción de registro. El bloqueo evita que dos
  // altas consuman el mismo código; un fallo revierte usuario, código y acceso.
  static async canjear(valor, usuario, transaction) {
    if (!transaction) throw new Error('El canje requiere una transacción.');
    const codigo = await CodigoPrueba.findOne({
      where: { codigo: String(valor).trim().toUpperCase() },
      transaction, lock: transaction.LOCK.UPDATE,
    });
    if (!codigo || !codigo.activo || codigo.usado_en || (codigo.vence_en && new Date(codigo.vence_en) <= new Date())) throw error('El código de prueba no está disponible: es inválido, venció o ya fue utilizado.');
    if (codigo.email && codigo.email !== usuario.correo_electronico.toLowerCase()) throw error('Este código de prueba está asignado a otro correo.');
    const plan = await Plan.findOne({ where: { id: codigo.plan_id, activo: true, equivale_plan: 'pago' }, transaction });
    if (!plan) throw error('El plan de este código ya no está disponible.');
    const inicio = new Date();
    const fin = new Date(inicio.getTime() + codigo.dias * 86400000);
    const suscripcion = await Suscripcion.create({
      usuario_id: usuario.id, email: usuario.correo_electronico.toLowerCase(), nombre: usuario.nombre,
      telefono: usuario.telefono, plan_id: plan.id, estado: 'activa', precio_pagado: 0,
      periodo_inicio: inicio, periodo_fin: fin,
      ruta_acceso: resolverRuta(plan, codigo.ruta_acceso),
    }, { transaction });
    await codigo.update({ usado_por: usuario.id, usado_en: inicio, suscripcion_id: suscripcion.id }, { transaction });
    await usuario.update({ plan: plan.equivale_plan }, { transaction });
    return { dias: codigo.dias, periodo_fin: fin };
  }
}
module.exports = CodigoPruebaService;
