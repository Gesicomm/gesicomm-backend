const crypto = require('crypto');
const { Op } = require('sequelize');
const { Afiliado, AfiliadoClick, AfiliadoComision, Suscripcion, PagoSuscripcion, Plan } = require('../models');

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

class AfiliadosService {
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
      nombre: data.nombre,
      email: data.email,
      codigo: data.codigo,
      comision_pct: Number(data.comision_pct || 0),
      estado: data.estado,
      notas: data.notas,
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
    const afiliados = await Afiliado.findAll({ order: [['created_at', 'DESC']] });
    return afiliados.map(a => this.serializarAfiliado(a, baseUrl));
  }

  static async crear(datos, { baseUrl } = {}) {
    const nombre = String(datos.nombre || '').trim();
    if (!nombre) throw Object.assign(new Error('El nombre del afiliado es obligatorio.'), { status: 400 });
    const codigo = await this.codigoDisponible(datos.codigo || nombre);
    const afiliado = await Afiliado.create({
      nombre,
      email: datos.email ? String(datos.email).trim().toLowerCase() : null,
      codigo,
      comision_pct: Number(datos.comision_pct ?? 40),
      estado: datos.estado === 'pausado' ? 'pausado' : 'activo',
      notas: datos.notas || null,
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
    if (datos.codigo !== undefined) cambios.codigo = await this.codigoDisponible(datos.codigo || afiliado.nombre, afiliado.id);
    if (datos.comision_pct !== undefined) cambios.comision_pct = Math.max(0, Math.min(100, Number(datos.comision_pct) || 0));
    if (datos.estado !== undefined) cambios.estado = datos.estado === 'pausado' ? 'pausado' : 'activo';
    if (datos.notas !== undefined) cambios.notas = datos.notas || null;

    await afiliado.update(cambios);
    return this.serializarAfiliado(afiliado, baseUrl);
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
