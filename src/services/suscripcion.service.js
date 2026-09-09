const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize, Plan, Suscripcion, PagoSuscripcion, Usuario, Tienda } = require('../models');
const PagoParService = require('./payments/pagoParService');
const parametros = require('./parametros.service');

const PLANES_PAGOS_BASE = [
  {
    codigo: 'starter',
    nombre: 'Starter',
    resumen: 'Para activar tu primera tienda online con catálogo, landing y pedidos desde el primer día.',
    precio: 47,
    moneda: 'USD',
    periodicidad: 'mensual',
    equivale_plan: 'pago',
    features: [
      'Tienda y catálogo online',
      'Landing con ficha seleccionable',
      'Selección de productos desde Gesicomm',
      'Pedidos y contactos desde el panel',
    ],
    etiqueta: 'Para empezar',
    cta: 'Activar Starter',
    destacado: true,
    orden: 1,
  },
  {
    codigo: 'growth',
    nombre: 'Growth',
    resumen: 'Para tiendas que quieren más landings, más medición y una operación comercial más completa.',
    precio: 97,
    moneda: 'USD',
    periodicidad: 'mensual',
    equivale_plan: 'pago',
    features: [
      'Todo lo del plan Starter',
      'Landings y embudos adicionales',
      'Configuración avanzada de productos',
      'Analítica comercial y píxeles',
    ],
    etiqueta: 'Más elegido',
    cta: 'Activar Growth',
    destacado: false,
    orden: 2,
  },
  {
    codigo: 'scale',
    nombre: 'Scale',
    resumen: 'Para operaciones con catálogo grande, equipo y automatización comercial.',
    precio: 197,
    moneda: 'USD',
    periodicidad: 'mensual',
    equivale_plan: 'pago',
    features: [
      'Todo lo del plan Growth',
      'Productos y pedidos sin límite operativo',
      'Automatizaciones y canales de venta',
      'Soporte prioritario',
    ],
    etiqueta: null,
    cta: 'Activar Scale',
    destacado: false,
    orden: 3,
  },
];

function sumarPeriodo(inicio, periodicidad) {
  const fin = new Date(inicio);
  if (periodicidad === 'anual') fin.setFullYear(fin.getFullYear() + 1);
  else if (periodicidad === 'mensual') fin.setMonth(fin.getMonth() + 1);
  else return null;
  return fin;
}

/**
 * Cobro de las suscripciones de Gesicomm.
 *
 * Ojo con de quién son las credenciales: `payment_gateways` guarda las de
 * CADA COMERCIO, para que le cobren a sus propios clientes. Acá es Gesicomm
 * cobrándole a sus clientes, así que sus credenciales son del sistema — no
 * van en esa tabla, donde Gesicomm no es un comercio más.
 *
 * Viven en la tabla `parametros` (cifrado el privado), para poder rotarlas
 * desde el panel sin tocar el servidor. Si no están cargadas ahí, se cae al
 * process.env con el mismo nombre, así la migración desde el .env es gradual.
 *
 * El flujo es: elegir plan → pagar → recién ahí registrarse. Por eso en el
 * momento del cobro no existe ningún Usuario y la suscripción se identifica
 * por email. Cuando PagoPar confirma, se emite un token de un solo uso con
 * el que la persona completa el alta.
 */
class SuscripcionService {
  static planesPagosBase() {
    return PLANES_PAGOS_BASE.map(p => ({ ...p, features: [...p.features] }));
  }

  static async listarPlanesPagos() {
    return this.planesPagosBase();
  }

  static planBasePorCodigo(codigo) {
    return PLANES_PAGOS_BASE.find(p => p.codigo === codigo) || null;
  }

  static async asegurarPlanBase(codigo, transaction) {
    const base = this.planBasePorCodigo(codigo);
    if (!base) {
      throw Object.assign(new Error('Ese plan no existe o ya no se ofrece.'), { status: 404 });
    }

    const payload = {
      codigo: base.codigo,
      nombre: base.nombre,
      resumen: base.resumen,
      precio: base.precio,
      periodicidad: base.periodicidad,
      equivale_plan: 'pago',
      features: base.features,
      etiqueta: base.etiqueta,
      cta: base.cta,
      destacado: base.destacado,
      orden: base.orden,
      activo: true,
    };

    const [plan, creado] = await Plan.findOrCreate({
      where: { codigo: base.codigo },
      defaults: payload,
      transaction,
    });

    if (!creado) {
      await plan.update(payload, { transaction });
    }

    return plan;
  }

  /** Credenciales del sistema, con la misma forma que espera PagoParService. */
  static async gatewayDeSistema() {
    const { PAGOPAR_PUBLIC_KEY: public_key, PAGOPAR_PRIVATE_KEY: private_key } =
      await parametros.obtenerVarios(['PAGOPAR_PUBLIC_KEY', 'PAGOPAR_PRIVATE_KEY']);
    if (!public_key || !private_key) {
      throw Object.assign(
        new Error('Faltan las credenciales de PagoPar del sistema. Cargalas en Configuración → Parámetros.'),
        { status: 503 },
      );
    }
    return { public_key, private_key };
  }

  /**
   * Arranca el checkout de un plan.
   * @returns {{ payment_url, hash_pedido, suscripcion_id, referencia }}
   */
  static async iniciarCheckout({ plan_codigo, email, nombre }) {
    const correo = String(email || '').trim().toLowerCase();
    if (!correo || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
      throw Object.assign(new Error('Ingresá un correo válido.'), { status: 400 });
    }

    const plan = await Plan.findOne({ where: { codigo: plan_codigo, activo: true } });
    if (!plan) {
      throw Object.assign(new Error('Ese plan no existe o ya no se ofrece.'), { status: 404 });
    }
    if (plan.precio <= 0) {
      throw Object.assign(new Error('Este plan no requiere pago.'), { status: 400 });
    }

    // Si ese correo ya tiene cuenta, no tiene sentido el flujo de alta.
    const yaEsUsuario = await Usuario.findOne({ where: { correo_electronico: correo } });
    if (yaEsUsuario) {
      throw Object.assign(
        new Error('Ese correo ya tiene una cuenta. Iniciá sesión y cambiá tu plan desde ahí.'),
        { status: 409 },
      );
    }

    const gateway = await this.gatewayDeSistema();

    const { suscripcion, pago } = await sequelize.transaction(async (t) => {
      const suscripcion = await Suscripcion.create({
        plan_id: plan.id,
        usuario_id: null,
        email: correo,
        nombre: nombre || null,
        estado: 'pendiente_pago',
        precio_pagado: plan.precio,
      }, { transaction: t });

      const pago = await PagoSuscripcion.create({
        suscripcion_id: suscripcion.id,
        provider: 'pagopar',
        // La referencia es el único identificador que generamos nosotros.
        // Prefijo "SUS" para no colisionar con los ids de Envio, que viajan
        // pelados por el otro webhook.
        referencia: `SUS${suscripcion.id}`,
        estado: 'PENDING',
        monto: plan.precio,
      }, { transaction: t });

      return { suscripcion, pago };
    });

    // Se le da a PagoPar la forma de "pedido" que espera iniciar-transaccion.
    const pedidoFicticio = {
      id: pago.referencia,
      monto: plan.precio,
      costo_envio: 0,
      cliente: nombre || correo,
      telefono: '',
      direccion: '',
      ruc: '',
      items: [{ nombre_producto: `Plan ${plan.nombre}`, cantidad: 1, subtotal: plan.precio }],
    };

    const resultado = await PagoParService.createTransaction(gateway, pedidoFicticio, null);

    await pago.update({ hash_pedido: resultado.hash_pedido });

    return {
      payment_url: resultado.payment_url,
      hash_pedido: resultado.hash_pedido,
      suscripcion_id: suscripcion.id,
      referencia: pago.referencia,
    };
  }

  /**
   * Acredita un pago y emite el token con el que se completa el registro.
   * Idempotente: si el pago ya estaba en PAID, devuelve lo mismo sin repetir.
   */
  static async acreditarPago(pago, datosCrudos = null) {
    if (pago.estado === 'PAID') {
      const susc = await Suscripcion.findByPk(pago.suscripcion_id);
      return { yaEstaba: true, suscripcion: susc };
    }

    return sequelize.transaction(async (t) => {
      const suscripcion = await Suscripcion.findByPk(pago.suscripcion_id, { transaction: t });

      await pago.update({
        estado: 'PAID',
        pagado_en: new Date(),
        respuesta_pasarela: datosCrudos,
      }, { transaction: t });

      const inicio = new Date();
      const plan = await Plan.findByPk(suscripcion.plan_id, { transaction: t });
      const fin = sumarPeriodo(inicio, plan.periodicidad);

      const cambios = {
        estado: 'activa',
        periodo_inicio: inicio,
        periodo_fin: fin,
      };

      // El token solo tiene sentido si todavía no hay Usuario detrás.
      if (!suscripcion.usuario_id) {
        cambios.token_registro = crypto.randomBytes(32).toString('hex');
        cambios.token_registro_expira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      }

      await suscripcion.update(cambios, { transaction: t });
      return { yaEstaba: false, suscripcion };
    });
  }

  /** Estado público de un cobro, para la pantalla de resultado. */
  static async estadoPorHash(hashPedido) {
    const pago = await PagoSuscripcion.findOne({ where: { hash_pedido: hashPedido } });
    if (!pago) return null;

    const suscripcion = await Suscripcion.findByPk(pago.suscripcion_id, { include: [Plan] });
    return {
      estado_pago: pago.estado,
      estado_suscripcion: suscripcion.estado,
      plan: suscripcion.Plan ? { codigo: suscripcion.Plan.codigo, nombre: suscripcion.Plan.nombre } : null,
      email: suscripcion.email,
      monto: pago.monto,
      // Solo se entrega si está pagado y todavía no se usó.
      token_registro: pago.estado === 'PAID' && !suscripcion.usuario_id
        ? suscripcion.token_registro
        : null,
    };
  }

  /** Valida un token de registro y devuelve la suscripción, o null. */
  static async suscripcionPorToken(token) {
    if (!token) return null;
    const suscripcion = await Suscripcion.findOne({
      where: { token_registro: token, estado: 'activa' },
      include: [Plan],
    });
    if (!suscripcion) return null;
    if (suscripcion.usuario_id) return null; // ya se usó
    if (suscripcion.token_registro_expira && suscripcion.token_registro_expira < new Date()) return null;
    return suscripcion;
  }

  /** Ata la suscripción al Usuario recién creado y quema el token. */
  static async vincularUsuario(suscripcion, usuarioId, transaction) {
    await suscripcion.update({
      usuario_id: usuarioId,
      token_registro: null,
      token_registro_expira: null,
    }, { transaction });
  }

  static async suscripcionActivaDeUsuario(usuarioId) {
    return Suscripcion.findOne({
      where: {
        usuario_id: usuarioId,
        estado: 'activa',
        [Op.or]: [
          { periodo_fin: null },
          { periodo_fin: { [Op.gt]: new Date() } },
        ],
      },
      include: [Plan],
      order: [['periodo_inicio', 'DESC'], ['created_at', 'DESC']],
    });
  }

  static serializarSuscripcion(suscripcion) {
    if (!suscripcion) return null;
    const data = suscripcion.toJSON ? suscripcion.toJSON() : suscripcion;
    return {
      id: data.id,
      estado: data.estado,
      periodo_inicio: data.periodo_inicio,
      periodo_fin: data.periodo_fin,
      plan: data.Plan ? {
        codigo: data.Plan.codigo,
        nombre: data.Plan.nombre,
        precio: data.Plan.precio,
        periodicidad: data.Plan.periodicidad,
      } : null,
    };
  }

  static async estadoCuenta(usuarioId) {
    const [suscripcion, tienda] = await Promise.all([
      this.suscripcionActivaDeUsuario(usuarioId),
      Tienda.findOne({ where: { usuario_id: usuarioId }, attributes: ['id'] }),
    ]);

    return {
      tiene_suscripcion_activa: !!suscripcion,
      requiere_pago: !suscripcion,
      requiere_onboarding: !!suscripcion && !tienda,
      tienda_id: tienda?.id || null,
      suscripcion: this.serializarSuscripcion(suscripcion),
      modo_pago: 'pagopar_dummy',
    };
  }

  /**
   * PagoPar dummy para desarrollo del flujo: simula el callback exitoso de
   * PagoPar y deja la suscripción activa. Cuando se conecte PagoPar real, el
   * guard del frontend seguirá consultando estadoCuenta().
   */
  static async simularPagoPagopar(usuarioId, planCodigo) {
    const usuario = await Usuario.findByPk(usuarioId);
    if (!usuario) {
      throw Object.assign(new Error('Usuario no encontrado.'), { status: 404 });
    }

    const activa = await this.suscripcionActivaDeUsuario(usuarioId);
    if (activa) {
      return {
        ya_estaba_activa: true,
        suscripcion: this.serializarSuscripcion(activa),
        estado_cuenta: await this.estadoCuenta(usuarioId),
      };
    }

    const { suscripcion } = await sequelize.transaction(async (t) => {
      const plan = await this.asegurarPlanBase(planCodigo, t);
      const inicio = new Date();
      const fin = sumarPeriodo(inicio, plan.periodicidad);

      const suscripcion = await Suscripcion.create({
        plan_id: plan.id,
        usuario_id: usuario.id,
        email: String(usuario.correo_electronico || '').trim().toLowerCase(),
        nombre: usuario.nombre || null,
        estado: 'activa',
        precio_pagado: plan.precio,
        periodo_inicio: inicio,
        periodo_fin: fin,
      }, { transaction: t });

      await PagoSuscripcion.create({
        suscripcion_id: suscripcion.id,
        provider: 'pagopar_dummy',
        referencia: `DUMMY-PAGOPAR-${suscripcion.id}`,
        hash_pedido: `dummy_${suscripcion.id}_${Date.now()}`,
        estado: 'PAID',
        monto: plan.precio,
        pagado_en: inicio,
        respuesta_pasarela: {
          modo: 'dummy',
          provider_futuro: 'pagopar',
          plan_codigo: plan.codigo,
          nota: 'Pago simulado para habilitar el flujo de onboarding.',
        },
      }, { transaction: t });

      await usuario.update({ plan: 'pago' }, { transaction: t });

      return { suscripcion };
    });

    const completa = await Suscripcion.findByPk(suscripcion.id, { include: [Plan] });
    return {
      ya_estaba_activa: false,
      suscripcion: this.serializarSuscripcion(completa),
      estado_cuenta: await this.estadoCuenta(usuarioId),
    };
  }
}

module.exports = SuscripcionService;
