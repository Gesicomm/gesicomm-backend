const crypto = require('crypto');
const { Op } = require('sequelize');
const { Afiliado, AfiliadoClick, AfiliadoComision, Suscripcion, PagoSuscripcion, Plan, Usuario } = require('../models');
const BrevoService = require('./brevo.service');
const { logger } = require('../utils/logger');

function slugCodigo(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(String(ip)).digest('hex');
}

function textoONull(valor) {
  const limpio = String(valor || '').trim();
  return limpio || null;
}

function resumenComisiones(comisiones = []) {
  const base = {
    pendiente: 0,
    aprobada: 0,
    pagada: 0,
    anulada: 0,
    total_generado: 0,
    total_a_liquidar: 0,
  };

  for (const comision of comisiones) {
    const data = comision.toJSON ? comision.toJSON() : comision;
    const monto = Number(data.monto_comision || 0);
    const estado = data.estado || 'pendiente';
    if (base[estado] !== undefined) base[estado] += monto;
    if (estado !== 'anulada') base.total_generado += monto;
    if (estado === 'pendiente' || estado === 'aprobada') base.total_a_liquidar += monto;
  }

  return base;
}

class AfiliadosService {
  static async verificarUsuarioFundador(usuarioId) {
    const suscripcion = await Suscripcion.findOne({
      where: {
        usuario_id: usuarioId,
        estado: 'activa',
        [Op.or]: [
          { periodo_fin: null },
          { periodo_fin: { [Op.gt]: new Date() } },
        ],
      },
      include: [{ model: Plan, where: { codigo: 'founders' }, required: true }],
      order: [['periodo_inicio', 'DESC'], ['created_at', 'DESC']],
    });

    if (!suscripcion) {
      throw Object.assign(
        new Error('El programa de afiliados está disponible solo para usuarios con plan Fundador.'),
        { status: 403 },
      );
    }

    return suscripcion;
  }

  static async codigoDisponible(base, ignorarId = null) {
    let codigo = slugCodigo(base) || `afiliado-${Date.now()}`;
    const original = codigo;
    let intento = 2;
    while (true) {
      const where = { codigo };
      if (ignorarId) where.id = { [Op.ne]: ignorarId };
      const existe = await Afiliado.findOne({ where });
      if (!existe) return codigo;
      codigo = `${original}-${intento}`;
      intento += 1;
    }
  }

  static serializarAfiliado(afiliado, baseUrl = null) {
    if (!afiliado) return null;
    const data = afiliado.toJSON ? afiliado.toJSON() : afiliado;
    const origen = baseUrl || process.env.FRONTEND_URL || 'https://gesicomm.com';
    const url = `${String(origen).replace(/\/$/, '')}/planes?ref=${encodeURIComponent(data.codigo)}`;
    return {
      id: data.id,
      usuario_id: data.usuario_id,
      nombre: data.nombre,
      email: data.email,
      telefono: data.telefono,
      codigo: data.codigo,
      comision_pct: Number(data.comision_pct || 0),
      estado: data.estado,
      metodo_pago: data.metodo_pago,
      entidad_pago: data.entidad_pago,
      titular_pago: data.titular_pago,
      documento_pago: data.documento_pago,
      cuenta_pago: data.cuenta_pago,
      notas: data.notas,
      resumen_comisiones: resumenComisiones(data.comisiones || []),
      link: url,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  static serializarComision(comision) {
    const data = comision.toJSON ? comision.toJSON() : comision;
    return {
      id: data.id,
      afiliado_id: data.afiliado_id,
      afiliado: data.afiliado ? this.serializarAfiliado(data.afiliado) : null,
      suscripcion_id: data.suscripcion_id,
      pago_suscripcion_id: data.pago_suscripcion_id,
      monto_base: data.monto_base,
      comision_pct: Number(data.comision_pct || 0),
      monto_comision: data.monto_comision,
      estado: data.estado,
      notas: data.notas,
      cliente_email: data.suscripcion?.email || null,
      plan: data.suscripcion?.Plan ? data.suscripcion.Plan.nombre : null,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  static async listar({ baseUrl } = {}) {
    const afiliados = await Afiliado.findAll({
      include: [{ model: AfiliadoComision, as: 'comisiones', attributes: ['estado', 'monto_comision'] }],
      order: [['created_at', 'DESC']],
    });
    return afiliados.map(a => this.serializarAfiliado(a, baseUrl));
  }

  static async crear(datos, { baseUrl } = {}) {
    const nombre = String(datos.nombre || '').trim();
    if (!nombre) throw Object.assign(new Error('El nombre del afiliado es obligatorio.'), { status: 400 });
    const codigo = await this.codigoDisponible(datos.codigo || nombre);
    const afiliado = await Afiliado.create({
      usuario_id: datos.usuario_id || null,
      nombre,
      email: datos.email ? String(datos.email).trim().toLowerCase() : null,
      telefono: textoONull(datos.telefono),
      codigo,
      comision_pct: Number(datos.comision_pct ?? 40),
      estado: datos.estado === 'pausado' ? 'pausado' : 'activo',
      metodo_pago: textoONull(datos.metodo_pago),
      entidad_pago: textoONull(datos.entidad_pago),
      titular_pago: textoONull(datos.titular_pago),
      documento_pago: textoONull(datos.documento_pago),
      cuenta_pago: textoONull(datos.cuenta_pago),
      notas: textoONull(datos.notas),
    });
    return this.serializarAfiliado(afiliado, baseUrl);
  }

  static async obtenerDeUsuario(usuarioId, { baseUrl } = {}) {
    await this.verificarUsuarioFundador(usuarioId);
    const afiliado = await Afiliado.findOne({
      where: { usuario_id: usuarioId },
      include: [{ model: AfiliadoComision, as: 'comisiones', attributes: ['estado', 'monto_comision'] }],
    });
    return this.serializarAfiliado(afiliado, baseUrl);
  }

  static async solicitarParaUsuario(usuarioId, datos = {}, { baseUrl } = {}) {
    await this.verificarUsuarioFundador(usuarioId);
    const usuario = await Usuario.findByPk(usuarioId);
    if (!usuario) throw Object.assign(new Error('Usuario no encontrado.'), { status: 404 });

    const email = String(usuario.correo_electronico || '').trim().toLowerCase();
    const existente = await Afiliado.findOne({
      where: {
        [Op.or]: [
          { usuario_id: usuario.id },
          ...(email ? [{ email }] : []),
        ],
      },
      include: [{ model: AfiliadoComision, as: 'comisiones', attributes: ['estado', 'monto_comision'] }],
    });

    if (existente) {
      const cambios = { usuario_id: usuario.id };
      if (datos.nombre !== undefined) {
        const nombre = String(datos.nombre || '').trim();
        if (!nombre) throw Object.assign(new Error('El nombre del afiliado es obligatorio.'), { status: 400 });
        cambios.nombre = nombre;
      }
      if (datos.telefono !== undefined) cambios.telefono = textoONull(datos.telefono);
      if (datos.metodo_pago !== undefined) cambios.metodo_pago = textoONull(datos.metodo_pago);
      if (datos.entidad_pago !== undefined) cambios.entidad_pago = textoONull(datos.entidad_pago);
      if (datos.titular_pago !== undefined) cambios.titular_pago = textoONull(datos.titular_pago);
      if (datos.documento_pago !== undefined) cambios.documento_pago = textoONull(datos.documento_pago);
      if (datos.cuenta_pago !== undefined) cambios.cuenta_pago = textoONull(datos.cuenta_pago);
      await existente.update(cambios);
      return this.obtenerDeUsuario(usuario.id, { baseUrl });
    }

    const nombre = String(datos.nombre || usuario.nombre || '').trim();
    if (!nombre) throw Object.assign(new Error('El nombre del afiliado es obligatorio.'), { status: 400 });

    const codigo = await this.codigoDisponible(datos.codigo || nombre);
    const afiliado = await Afiliado.create({
      usuario_id: usuario.id,
      nombre,
      email,
      telefono: textoONull(datos.telefono),
      codigo,
      comision_pct: Number(datos.comision_pct ?? 40),
      estado: 'activo',
      metodo_pago: textoONull(datos.metodo_pago),
      entidad_pago: textoONull(datos.entidad_pago),
      titular_pago: textoONull(datos.titular_pago),
      documento_pago: textoONull(datos.documento_pago),
      cuenta_pago: textoONull(datos.cuenta_pago),
      notas: textoONull(datos.notas),
    });
    return this.serializarAfiliado(afiliado, baseUrl);
  }

  static async actualizar(id, datos, { baseUrl } = {}) {
    const afiliado = await Afiliado.findByPk(id);
    if (!afiliado) throw Object.assign(new Error('Afiliado no encontrado.'), { status: 404 });

    const cambios = {};
    if (datos.nombre !== undefined) cambios.nombre = String(datos.nombre || '').trim();
    if (!cambios.nombre && datos.nombre !== undefined) {
      throw Object.assign(new Error('El nombre del afiliado es obligatorio.'), { status: 400 });
    }
    if (datos.email !== undefined) cambios.email = datos.email ? String(datos.email).trim().toLowerCase() : null;
    if (datos.telefono !== undefined) cambios.telefono = textoONull(datos.telefono);
    if (datos.codigo !== undefined) cambios.codigo = await this.codigoDisponible(datos.codigo || afiliado.nombre, afiliado.id);
    if (datos.comision_pct !== undefined) cambios.comision_pct = Math.max(0, Math.min(100, Number(datos.comision_pct) || 0));
    if (datos.estado !== undefined) cambios.estado = datos.estado === 'pausado' ? 'pausado' : 'activo';
    if (datos.metodo_pago !== undefined) cambios.metodo_pago = textoONull(datos.metodo_pago);
    if (datos.entidad_pago !== undefined) cambios.entidad_pago = textoONull(datos.entidad_pago);
    if (datos.titular_pago !== undefined) cambios.titular_pago = textoONull(datos.titular_pago);
    if (datos.documento_pago !== undefined) cambios.documento_pago = textoONull(datos.documento_pago);
    if (datos.cuenta_pago !== undefined) cambios.cuenta_pago = textoONull(datos.cuenta_pago);
    if (datos.notas !== undefined) cambios.notas = textoONull(datos.notas);

    await afiliado.update(cambios);
    const completo = await Afiliado.findByPk(id, {
      include: [{ model: AfiliadoComision, as: 'comisiones', attributes: ['estado', 'monto_comision'] }],
    });
    return this.serializarAfiliado(completo, baseUrl);
  }

  static async eliminar(id) {
    const afiliado = await Afiliado.findByPk(id);
    if (!afiliado) throw Object.assign(new Error('Afiliado no encontrado.'), { status: 404 });
    await afiliado.destroy();
  }

  static async resolverActivo(codigo) {
    const limpio = slugCodigo(codigo);
    if (!limpio) return null;
    return Afiliado.findOne({ where: { codigo: limpio, estado: 'activo' } });
  }

  static async registrarClick({ codigo, landingUrl, ip, userAgent }) {
    const afiliado = await this.resolverActivo(codigo);
    if (!afiliado) return null;
    await AfiliadoClick.create({
      afiliado_id: afiliado.id,
      codigo: afiliado.codigo,
      landing_url: landingUrl || null,
      ip_hash: hashIp(ip),
      user_agent: userAgent || null,
    });
    return this.serializarAfiliado(afiliado);
  }

  static async crearComisionPorPago(pago, transaction) {
    if (!pago || pago.estado !== 'PAID') return null;
    const suscripcion = await Suscripcion.findByPk(pago.suscripcion_id, { transaction });
    if (!suscripcion?.afiliado_id) return null;

    const afiliado = await Afiliado.findByPk(suscripcion.afiliado_id, { transaction });
    if (!afiliado || afiliado.estado !== 'activo') return null;

    const pct = Number(afiliado.comision_pct || 0);
    const base = Number(pago.monto || suscripcion.precio_pagado || 0);
    const monto = Math.round(base * (pct / 100));

    const [comision] = await AfiliadoComision.findOrCreate({
      where: { pago_suscripcion_id: pago.id },
      defaults: {
        afiliado_id: afiliado.id,
        suscripcion_id: suscripcion.id,
        pago_suscripcion_id: pago.id,
        monto_base: base,
        comision_pct: pct,
        monto_comision: monto,
        estado: 'pendiente',
      },
      transaction,
    });
    return comision;
  }

  static async notificarVentaAtribuidaPorPago(pagoSuscripcionId) {
    const comision = await AfiliadoComision.findOne({
      where: { pago_suscripcion_id: pagoSuscripcionId },
      include: [
        { model: Afiliado, as: 'afiliado', include: [{ model: Usuario, as: 'usuario' }] },
        { model: Suscripcion, as: 'suscripcion', include: [Plan] },
        { model: PagoSuscripcion, as: 'pago' },
      ],
    });

    if (!comision || comision.brevo_notificado_en) return null;

    const afiliado = comision.afiliado;
    const destino = afiliado?.email || afiliado?.usuario?.correo_electronico;
    if (!destino) {
      await comision.update({ brevo_notificacion_error: 'Afiliado sin email para notificar.' });
      return null;
    }

    const plan = comision.suscripcion?.Plan;
    const monto = Number(comision.monto_base || 0);
    const montoComision = Number(comision.monto_comision || 0);
    const fechaVenta = comision.pago?.pagado_en || new Date();
    const payloadEvento = {
      affiliate_id: afiliado.id,
      plan_id: plan?.id || comision.suscripcion?.plan_id || null,
      monto,
      fecha_venta: fechaVenta,
      payment_id: pagoSuscripcionId,
    };

    const resultado = await BrevoService.enviarEmail({
      to: destino,
      subject: 'Nueva venta atribuida a tu link de afiliado',
      text: `Se confirmó una venta atribuida a tu link. Plan: ${plan?.nombre || 'Gesicomm'}. Monto: ${monto}. Comisión: ${montoComision}. Payment ID: ${pagoSuscripcionId}.`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
          <h1 style="font-size:20px;margin:0 0 12px">Nueva venta atribuida</h1>
          <p>Se confirmó una venta de Gesicomm atribuida a tu link de afiliado.</p>
          <ul>
            <li><strong>Plan:</strong> ${plan?.nombre || 'Gesicomm'}</li>
            <li><strong>Monto:</strong> ${monto}</li>
            <li><strong>Comisión estimada:</strong> ${montoComision}</li>
            <li><strong>Payment ID:</strong> ${pagoSuscripcionId}</li>
          </ul>
        </div>
      `,
    });

    if (resultado.enviado) {
      await comision.update({
        brevo_notificado_en: new Date(),
        brevo_notificacion_error: null,
        notas: comision.notas || JSON.stringify({ affiliate_notified: payloadEvento }),
      });
      logger.info({ mensaje: '[Afiliados] Venta notificada a Brevo.', ...payloadEvento });
    } else {
      await comision.update({
        brevo_notificacion_error: resultado.error || resultado.razon || 'Brevo no confirmó el envío.',
      });
      logger.warn({
        mensaje: '[Afiliados] Venta atribuida pendiente de notificación Brevo.',
        ...payloadEvento,
        error: resultado.error || resultado.razon,
      });
    }

    return resultado;
  }

  static async listarComisiones() {
    const comisiones = await AfiliadoComision.findAll({
      include: [
        { model: Afiliado, as: 'afiliado' },
        { model: Suscripcion, as: 'suscripcion', include: [Plan] },
      ],
      order: [['created_at', 'DESC']],
    });
    return comisiones.map(c => this.serializarComision(c));
  }

  static async actualizarComision(id, datos) {
    const comision = await AfiliadoComision.findByPk(id);
    if (!comision) throw Object.assign(new Error('Comisión no encontrada.'), { status: 404 });
    const estados = new Set(['pendiente', 'aprobada', 'pagada', 'anulada']);
    const cambios = {};
    if (datos.estado !== undefined && estados.has(datos.estado)) cambios.estado = datos.estado;
    if (datos.notas !== undefined) cambios.notas = datos.notas || null;
    await comision.update(cambios);
    const completa = await AfiliadoComision.findByPk(id, {
      include: [
        { model: Afiliado, as: 'afiliado' },
        { model: Suscripcion, as: 'suscripcion', include: [Plan] },
      ],
    });
    return this.serializarComision(completa);
  }
}

module.exports = AfiliadosService;
