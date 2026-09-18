const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize, Plan, CheckoutIntent, SubscriptionPurchase, Suscripcion, PagoSuscripcion, Usuario, Tienda } = require('../models');
const PagoParService = require('./payments/pagoParService');
const parametros = require('./parametros.service');
const AfiliadosService = require('./afiliados.service');
const AuthTracking = require('./authTracking.service');
const { logger } = require('../utils/logger');

const PLANES_PAGOS_BASE = [
  {
    codigo: 'founders',
    nombre: 'Miembros Fundadores',
    resumen: 'Oferta limitada para los primeros 300 clientes pagos en Paraguay, con precio fundador protegido mientras la suscripción permanezca activa.',
    precio: 47,
    moneda: 'USD',
    periodicidad: 'mensual',
    equivale_plan: 'pago',
    features: [
      'Precio Fundador protegido de USD 47/mes',
      'Acceso al ecosistema Gesicom y mejoras del nivel Fundador',
      'Onboarding, Academia, Biblioteca Operativa y comunidad privada',
      'Programa de Afiliados con 40% recurrente sobre suscripciones elegibles',
      '50% OFF para Gesicom Certified Partner',
    ],
    etiqueta: '300 cupos',
    cta: 'Ser Fundador',
    destacado: true,
    orden: 1,
    activo: true,
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
      'Todo lo del plan Fundador',
      'Landings y embudos adicionales',
      'Configuración avanzada de productos',
      'Analítica comercial y píxeles',
    ],
    etiqueta: 'Más elegido',
    cta: 'Activar Growth',
    destacado: false,
    orden: 2,
    activo: false,
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
    activo: false,
  },
];

const CHECKOUT_INTENT_TTL_MS = 48 * 60 * 60 * 1000;

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

  static serializarPlan(plan) {
    const data = plan && typeof plan.get === 'function' ? plan.get({ plain: true }) : plan;
    if (!data) return null;
    return {
      id: data.codigo,
      codigo: data.codigo,
      nombre: data.nombre,
      resumen: data.resumen || '',
      precio: Number(data.precio || 0),
      moneda: ['PYG', 'USD'].includes(data.moneda) ? data.moneda : 'PYG',
      periodicidad: data.periodicidad || 'mensual',
      equivale: data.equivale_plan || 'pago',
      equivale_plan: data.equivale_plan || 'pago',
      features: Array.isArray(data.features) ? data.features : [],
      etiqueta: data.etiqueta || '',
      cta: data.cta || '',
      destacado: !!data.destacado,
      orden: Number(data.orden || 0),
      activo: data.activo !== false,
    };
  }

  static payloadPlanBase(base) {
    return {
      codigo: base.codigo,
      nombre: base.nombre,
      resumen: base.resumen,
      precio: base.precio,
      moneda: ['PYG', 'USD'].includes(base.moneda) ? base.moneda : 'PYG',
      periodicidad: base.periodicidad,
      equivale_plan: 'pago',
      features: base.features,
      etiqueta: base.etiqueta,
      cta: base.cta,
      destacado: base.destacado,
      orden: base.orden,
      activo: base.activo !== false,
    };
  }

  static async sembrarPlanesBase(transaction = null) {
    if (!Plan.count || !Plan.findOrCreate) return;
    const opciones = transaction ? { transaction } : {};
    const total = await Plan.count(opciones);
    if (total > 0) return;

    await Promise.all(PLANES_PAGOS_BASE.map(base => Plan.findOrCreate({
      where: { codigo: base.codigo },
      defaults: this.payloadPlanBase(base),
      ...opciones,
    })));
  }

  static async listarPlanesPagos() {
    await this.sembrarPlanesBase();
    const planes = await Plan.findAll({
      where: { activo: true },
      order: [['orden', 'ASC'], ['id', 'ASC']],
    });
    return planes.map(plan => this.serializarPlan(plan));
  }

  static async listarPlanesAdmin() {
    await this.sembrarPlanesBase();
    const planes = await Plan.findAll({ order: [['orden', 'ASC'], ['id', 'ASC']] });
    return planes.map(plan => this.serializarPlan(plan));
  }

  static limpiarPlanAdmin(plan, indice) {
    const codigo = String(plan.codigo || plan.id || '').trim();
    const nombre = String(plan.nombre || '').trim();
    if (!codigo || !nombre) {
      throw Object.assign(new Error('Cada plan necesita código y nombre.'), { status: 400 });
    }
    return {
      codigo,
      nombre,
      resumen: String(plan.resumen || '').trim(),
      precio: Math.max(0, Math.round(Number(plan.precio || 0))),
      moneda: ['PYG', 'USD'].includes(plan.moneda) ? plan.moneda : 'PYG',
      periodicidad: ['mensual', 'anual', 'unico'].includes(plan.periodicidad) ? plan.periodicidad : 'mensual',
      equivale_plan: ['free', 'pago'].includes(plan.equivale_plan || plan.equivale) ? (plan.equivale_plan || plan.equivale) : 'pago',
      features: Array.isArray(plan.features) ? plan.features.map(f => String(f || '').trim()).filter(Boolean) : [],
      etiqueta: String(plan.etiqueta || '').trim() || null,
      cta: String(plan.cta || '').trim() || null,
      destacado: !!plan.destacado,
      activo: plan.activo !== false,
      orden: Number.isFinite(Number(plan.orden)) ? Number(plan.orden) : indice + 1,
    };
  }

  static async guardarPlanesAdmin(planes) {
    if (!Array.isArray(planes) || !planes.length) {
      throw Object.assign(new Error('Enviá al menos un plan.'), { status: 400 });
    }

    const limpios = planes.map((plan, indice) => this.limpiarPlanAdmin(plan, indice));
    let destacadoAsignado = false;
    for (const plan of limpios) {
      if (!plan.activo) plan.destacado = false;
      if (plan.destacado && !destacadoAsignado) {
        destacadoAsignado = true;
      } else if (plan.destacado) {
        plan.destacado = false;
      }
    }

    await sequelize.transaction(async (t) => {
      for (const plan of limpios) {
        const [fila] = await Plan.findOrCreate({
          where: { codigo: plan.codigo },
          defaults: plan,
          transaction: t,
        });
        await fila.update(plan, { transaction: t });
      }
    });

    return this.listarPlanesAdmin();
  }

  static async eliminarPlanAdmin(codigo) {
    const limpio = String(codigo || '').trim();
    if (!limpio) {
      throw Object.assign(new Error('Falta el código del plan.'), { status: 400 });
    }

    const plan = await Plan.findOne({ where: { codigo: limpio } });
    if (!plan) {
      throw Object.assign(new Error('Ese plan no existe.'), { status: 404 });
    }

    const suscripciones = await Suscripcion.count({ where: { plan_id: plan.id } });
    if (suscripciones > 0) {
      throw Object.assign(
        new Error('Este plan tiene suscripciones asociadas. Ocultalo para no ofrecerlo más sin romper el historial.'),
        { status: 409 },
      );
    }

    await plan.destroy();
    return this.listarPlanesAdmin();
  }

  static async crearCheckoutIntent({ plan_codigo, afiliado_codigo, usuario = null }) {
    await this.sembrarPlanesBase();
    const plan = await Plan.findOne({ where: { codigo: plan_codigo, activo: true } });
    if (!plan) {
      throw Object.assign(new Error('Ese plan no existe o ya no se ofrece.'), { status: 404 });
    }

    const usuarioExistente = usuario?.id ? await this.suscripcionActivaDeUsuario(usuario.id) : null;
    const afiliado = usuarioExistente ? null : await AfiliadosService.resolverActivo(afiliado_codigo);
    if (afiliado_codigo && !afiliado && !usuarioExistente) {
      logger.warn({
        mensaje: '[CheckoutIntent] affiliate_ref inválido o inactivo al crear intent inicial.',
        affiliate_ref: afiliado_codigo,
        plan_codigo,
      });
    }

    const intent = await CheckoutIntent.create({
      plan_id: plan.id,
      plan_codigo: plan.codigo,
      usuario_id: usuario?.id || null,
      authenticated: Boolean(usuario?.id),
      estado: 'active',
      affiliate_ref: afiliado?.codigo || null,
      affiliate_id: afiliado?.id || null,
      expires_at: new Date(Date.now() + CHECKOUT_INTENT_TTL_MS),
      metadata: {
        affiliate_ref_candidate: afiliado_codigo || null,
        source: 'plan_selected',
        existing_subscription: Boolean(usuarioExistente),
      },
    });

    return {
      checkout_intent_token: intent.token,
      checkout_intent_id: intent.id,
      expires_at: intent.expires_at,
      plan: this.serializarPlan(plan),
      afiliado: afiliado ? { codigo: afiliado.codigo, nombre: afiliado.nombre } : null,
    };
  }

  static planBasePorCodigo(codigo) {
    return PLANES_PAGOS_BASE.find(p => p.codigo === codigo) || null;
  }

  static async asegurarPlanBase(codigo, transaction) {
    const base = this.planBasePorCodigo(codigo);
    if (!base) {
      throw Object.assign(new Error('Ese plan no existe o ya no se ofrece.'), { status: 404 });
    }

    const payload = this.payloadPlanBase(base);

    const [plan, creado] = await Plan.findOrCreate({
      where: { codigo: base.codigo },
      defaults: payload,
      transaction,
    });

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
  static async iniciarCheckout({ plan_codigo, email, nombre, telefono, documento, afiliado_codigo, checkout_intent_token }) {
    const correo = String(email || '').trim().toLowerCase();
    if (!correo || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
      throw Object.assign(new Error('Ingresá un correo válido.'), { status: 400 });
    }
    const nombreLimpio = String(nombre || '').trim();
    if (nombreLimpio.length < 3) {
      throw Object.assign(new Error('Ingresá tu nombre completo.'), { status: 400 });
    }
    const telefonoLimpio = String(telefono || '').trim();
    if (telefonoLimpio.length < 6) {
      throw Object.assign(new Error('Ingresá un teléfono válido.'), { status: 400 });
    }
    const documentoLimpio = String(documento || '').trim();
    if (!/^[0-9.\-]{5,24}$/.test(documentoLimpio)) {
      throw Object.assign(new Error('Ingresá una cédula válida.'), { status: 400 });
    }

    await this.sembrarPlanesBase();

    let intentExistente = null;
    if (checkout_intent_token) {
      intentExistente = await CheckoutIntent.findOne({ where: { token: checkout_intent_token } });
      if (!intentExistente) {
        throw Object.assign(new Error('Tu selección de plan no es válida. Volvé a elegir un plan.'), { status: 404 });
      }
      if (intentExistente.estado !== 'active' || intentExistente.expires_at < new Date()) {
        if (intentExistente.estado === 'active') {
          await intentExistente.update({ estado: 'expired' });
        }
        throw Object.assign(new Error('Tu selección de plan venció. Volvé a elegir un plan.'), { status: 410 });
      }
      plan_codigo = intentExistente.plan_codigo;
    }

    const plan = await Plan.findOne({ where: { codigo: plan_codigo, activo: true } });
    if (!plan) {
      throw Object.assign(new Error('Ese plan no existe o ya no se ofrece.'), { status: 404 });
    }
    if (plan.precio <= 0) {
      throw Object.assign(new Error('Este plan no requiere pago.'), { status: 400 });
    }

    const yaEsUsuario = await Usuario.findOne({ where: { correo_electronico: correo } });
    if (yaEsUsuario) {
      const activaExistente = await this.suscripcionActivaDeUsuario(yaEsUsuario.id);
      if (activaExistente?.Plan?.equivale_plan === 'pago') {
        throw Object.assign(
          new Error('Ese correo ya tiene una cuenta con plan pago activo. Iniciá sesión y gestioná el cambio desde tu cuenta.'),
          { status: 409 },
        );
      }
    }

    const gateway = await this.gatewayDeSistema();
    const afiliado = yaEsUsuario ? null : (intentExistente
      ? null
      : await AfiliadosService.resolverActivo(afiliado_codigo));
    const affiliateId = yaEsUsuario ? null : (intentExistente ? intentExistente.affiliate_id : (afiliado?.id || null));
    const affiliateRef = yaEsUsuario ? null : (intentExistente ? intentExistente.affiliate_ref : (afiliado?.codigo || null));
    if (afiliado_codigo && !afiliado && !intentExistente && !yaEsUsuario) {
      logger.warn({
        mensaje: '[CheckoutIntent] affiliate_ref inválido o inactivo al crear intent.',
        affiliate_ref: afiliado_codigo,
        plan_codigo,
        email: correo,
      });
    }

    const { intent, purchase, suscripcion, pago } = await sequelize.transaction(async (t) => {
      await CheckoutIntent.update({
        estado: 'expired',
        abandoned_at: null,
      }, {
        where: {
          email: correo,
          estado: 'active',
          expires_at: { [Op.lt]: new Date() },
        },
        transaction: t,
      });

      await CheckoutIntent.update({
        estado: 'abandoned',
        abandoned_at: new Date(),
      }, {
        where: {
          email: correo,
          estado: 'active',
          expires_at: { [Op.gte]: new Date() },
          ...(intentExistente ? { id: { [Op.ne]: intentExistente.id } } : {}),
        },
        transaction: t,
      });

      let intent = intentExistente;
      if (intent) {
        await intent.update({
          usuario_id: yaEsUsuario?.id || intent.usuario_id || null,
          email: correo,
          nombre: nombreLimpio,
          telefono: telefonoLimpio,
          documento: documentoLimpio,
          authenticated: Boolean(yaEsUsuario) || intent.authenticated,
          affiliate_ref: yaEsUsuario ? null : intent.affiliate_ref,
          affiliate_id: yaEsUsuario ? null : intent.affiliate_id,
        }, { transaction: t });
      } else {
        intent = await CheckoutIntent.create({
          plan_id: plan.id,
          plan_codigo: plan.codigo,
          usuario_id: yaEsUsuario?.id || null,
          email: correo,
          nombre: nombreLimpio,
          telefono: telefonoLimpio,
          documento: documentoLimpio,
          authenticated: Boolean(yaEsUsuario),
          estado: 'active',
          affiliate_ref: affiliateRef,
          affiliate_id: affiliateId,
          expires_at: new Date(Date.now() + CHECKOUT_INTENT_TTL_MS),
          metadata: {
            affiliate_ref_candidate: afiliado_codigo || null,
            source: 'planes_checkout',
          },
        }, { transaction: t });
      }

      const suscripcion = await Suscripcion.create({
        plan_id: plan.id,
        checkout_intent_id: intent.id,
        usuario_id: yaEsUsuario?.id || null,
        email: correo,
        nombre: nombreLimpio,
        telefono: telefonoLimpio,
        documento: documentoLimpio,
        estado: 'pendiente_pago',
        precio_pagado: plan.precio,
        afiliado_id: intent.affiliate_id,
        afiliado_codigo: intent.affiliate_ref,
      }, { transaction: t });

      const purchase = await SubscriptionPurchase.create({
        checkout_intent_id: intent.id,
        suscripcion_id: suscripcion.id,
        plan_id: plan.id,
        plan_codigo: plan.codigo,
        usuario_id: yaEsUsuario?.id || null,
        email: correo,
        nombre: nombreLimpio,
        telefono: telefonoLimpio,
        documento: documentoLimpio,
        affiliate_ref: intent.affiliate_ref,
        affiliate_id: intent.affiliate_id,
        monto: plan.precio,
        moneda: ['PYG', 'USD'].includes(plan.moneda) ? plan.moneda : 'PYG',
        estado: 'created',
      }, { transaction: t });

      await suscripcion.update({ subscription_purchase_id: purchase.id }, { transaction: t });

      const pago = await PagoSuscripcion.create({
        suscripcion_id: suscripcion.id,
        subscription_purchase_id: purchase.id,
        provider: 'pagopar',
        // La referencia es el único identificador que generamos nosotros.
        // Prefijo "SUS" para no colisionar con los ids de Envio, que viajan
        // pelados por el otro webhook.
        referencia: `SUS${suscripcion.id}`,
        estado: 'PENDING',
        monto: plan.precio,
      }, { transaction: t });

      await purchase.update({
        payment_id: pago.id,
        estado: 'payment_started',
      }, { transaction: t });

      return { intent, purchase, suscripcion, pago };
    });

    // Se le da a PagoPar la forma de "pedido" que espera iniciar-transaccion.
    const pedidoFicticio = {
      id: pago.referencia,
      monto: plan.precio,
      costo_envio: 0,
      cliente: nombreLimpio,
      email: correo,
      telefono: telefonoLimpio,
      documento: documentoLimpio,
      direccion: '',
      ruc: '',
      items: [{ nombre_producto: `Plan ${plan.nombre}`, cantidad: 1, subtotal: plan.precio }],
    };

    let resultado;
    try {
      resultado = await PagoParService.createTransaction(gateway, pedidoFicticio, null);
      await pago.update({ hash_pedido: resultado.hash_pedido });
    } catch (error) {
      await Promise.all([
        pago.update({ estado: 'FAILED', respuesta_pasarela: { error: error.message } }),
        purchase.update({ estado: 'failed', metadata: { ...(purchase.metadata || {}), error_pago: error.message } }),
      ]);
      throw error;
    }

    return {
      payment_url: resultado.payment_url,
      hash_pedido: resultado.hash_pedido,
      checkout_intent_token: intent.token,
      checkout_intent_id: intent.id,
      subscription_purchase_id: purchase.id,
      suscripcion_id: suscripcion.id,
      payment_id: pago.id,
      referencia: pago.referencia,
    };
  }

  /**
   * Acredita un pago y emite el token con el que se completa el registro.
   * Idempotente: si el pago ya estaba en PAID, devuelve lo mismo sin repetir.
   */
  static async acreditarPago(pago, datosCrudos = null, { req = null, origen = 'PagoPar' } = {}) {
    // Chequeo barato para el caso comun. El que decide de verdad es el de
    // adentro, con la fila bloqueada: PagoPar REINTENTA el callback y la
    // pantalla de resultado consulta al abrirse, asi que dos avisos del mismo
    // pago pueden entrar a la vez. Sin bloqueo los dos pasaban este `if` (mira
    // un objeto en memoria cargado antes) y se emitian DOS token_registro: el
    // segundo pisaba al primero y dejaba muerto el enlace que la persona ya
    // tenia en pantalla, habiendo pagado.
    if (pago.estado === 'PAID') {
      const susc = await Suscripcion.findByPk(pago.suscripcion_id);
      return { yaEstaba: true, suscripcion: susc };
    }

    const resultado = await sequelize.transaction(async (t) => {
      const pagoFila = await PagoSuscripcion.findByPk(pago.id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!pagoFila || pagoFila.estado === 'PAID') {
        const susc = await Suscripcion.findByPk(pago.suscripcion_id, { transaction: t });
        return { yaEstaba: true, suscripcion: susc };
      }

      const suscripcion = await Suscripcion.findByPk(pago.suscripcion_id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      await pagoFila.update({
        estado: 'PAID',
        pagado_en: new Date(),
        respuesta_pasarela: datosCrudos,
      }, { transaction: t });
      pago.estado = 'PAID'; // el caller sigue usando su copia

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
      if (suscripcion.usuario_id) {
        await Usuario.update({ plan: 'pago' }, {
          where: { id: suscripcion.usuario_id },
          transaction: t,
        });
      }
      if (pagoFila.subscription_purchase_id) {
        const purchase = await SubscriptionPurchase.findByPk(pagoFila.subscription_purchase_id, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (purchase) {
          await purchase.update({
            estado: 'paid',
            suscripcion_id: suscripcion.id,
            payment_id: pagoFila.id,
            paid_at: new Date(),
          }, { transaction: t });
          await CheckoutIntent.update({
            estado: 'completed',
            completed_at: new Date(),
          }, {
            where: { id: purchase.checkout_intent_id, estado: 'active' },
            transaction: t,
          });
        }
      }
      await AfiliadosService.crearComisionPorPago(pagoFila, t);
      return { yaEstaba: false, suscripcion };
    });

    if (!resultado.yaEstaba) {
      const completa = await Suscripcion.findByPk(resultado.suscripcion.id, { include: [Plan] });
      const usuario = completa?.usuario_id ? await Usuario.findByPk(completa.usuario_id) : null;
      await AuthTracking.registrarEventoConNotificacion({
        tipo: 'subscription_payment_paid',
        req,
        usuario,
        email: completa?.email || pago.email,
        metadata: {
          origen,
          suscripcion_id: completa?.id || pago.suscripcion_id,
          pago_suscripcion_id: pago.id,
          referencia: pago.referencia,
          hash_pedido: pago.hash_pedido,
          monto: Number(pago.monto || completa?.precio_pagado || 0),
          moneda: ['PYG', 'USD'].includes(completa?.Plan?.moneda) ? completa.Plan.moneda : 'PYG',
          plan_codigo: completa?.Plan?.codigo || null,
          plan_nombre: completa?.Plan?.nombre || null,
        },
      });
      AfiliadosService.notificarVentaAtribuidaPorPago(pago.id)
        .catch(err => logger.error({
          mensaje: '[Afiliados] Error notificando venta atribuida.',
          pago_suscripcion_id: pago.id,
          error: err.message,
        }));
    }

    return resultado;
  }

  /**
   * Registra un intento rechazado por PagoPar. Idempotente: si ya se pagó no
   * pisa el estado; si ya falló solo refresca la respuesta cruda.
   */
  static async rechazarPago(pago, datosCrudos = null) {
    if (!pago || pago.estado === 'PAID') {
      return { ignorado: true, estado: pago?.estado || null };
    }

    const motivo = String(
      datosCrudos?.ultimo_mensaje_error ||
      datosCrudos?.mensaje ||
      datosCrudos?.error ||
      'PagoPar informó que el pago no fue acreditado.'
    ).trim();

    return sequelize.transaction(async (t) => {
      const pagoFila = await PagoSuscripcion.findByPk(pago.id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!pagoFila || pagoFila.estado === 'PAID') {
        return { ignorado: true, estado: pagoFila?.estado || null };
      }

      await pagoFila.update({
        estado: 'FAILED',
        respuesta_pasarela: datosCrudos,
      }, { transaction: t });
      pago.estado = 'FAILED';

      const suscripcion = await Suscripcion.findByPk(pagoFila.suscripcion_id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (suscripcion && suscripcion.estado === 'pendiente_pago') {
        await suscripcion.update({ estado: 'cancelada' }, { transaction: t });
      }

      if (pagoFila.subscription_purchase_id) {
        const purchase = await SubscriptionPurchase.findByPk(pagoFila.subscription_purchase_id, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (purchase && purchase.estado !== 'paid') {
          await purchase.update({
            estado: 'failed',
            payment_id: pagoFila.id,
            metadata: {
              ...(purchase.metadata || {}),
              error_pago: motivo,
              respuesta_pasarela: datosCrudos,
            },
          }, { transaction: t });
          const intent = await CheckoutIntent.findByPk(purchase.checkout_intent_id, {
            transaction: t,
            lock: t.LOCK.UPDATE,
          });
          if (intent && intent.estado === 'active') {
            await intent.update({
              estado: 'abandoned',
              abandoned_at: new Date(),
              metadata: {
                ...(intent.metadata || {}),
                error_pago: motivo,
              },
            }, { transaction: t });
          }
        }
      }

      return { ignorado: false, estado: 'FAILED', motivo };
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
      nombre: suscripcion.nombre,
      telefono: suscripcion.telefono,
      documento: suscripcion.documento,
      usuario_id: suscripcion.usuario_id,
      requiere_registro: !suscripcion.usuario_id,
      monto: pago.monto,
      error_pago: pago.estado === 'FAILED'
        ? (pago.respuesta_pasarela?.ultimo_mensaje_error || pago.respuesta_pasarela?.mensaje || pago.respuesta_pasarela?.error || null)
        : null,
      // Solo se entrega si está pagado y todavía no se usó.
      token_registro: pago.estado === 'PAID' && !suscripcion.usuario_id
        ? suscripcion.token_registro
        : null,
    };
  }

  /**
   * Paso 3 de PagoPar para suscripciones: consulta el estado real del pedido
   * contra /api/pedidos/1.1/traer y reconcilia nuestra base si hace falta.
   */
  static async consultarYReconciliarPagoPorHash(hashPedido, { req = null, origen = 'PagoPar consulta suscripción' } = {}) {
    const pago = await PagoSuscripcion.findOne({ where: { hash_pedido: hashPedido } });
    if (!pago) return null;

    if (pago.estado === 'PAID') {
      return this.estadoPorHash(hashPedido);
    }

    const gateway = await this.gatewayDeSistema();
    const consulta = await PagoParService.consultarEstadoPedido(gateway, hashPedido);
    const datos = consulta.datos || null;

    if (consulta.pagado) {
      await this.acreditarPago(pago, datos, { req, origen });
    } else if (datos?.cancelado === true || datos?.cancelado === 'true' || datos?.ultimo_mensaje_error) {
      await this.rechazarPago(pago, datos);
    } else if (datos) {
      await pago.update({ respuesta_pasarela: datos });
    }

    return this.estadoPorHash(hashPedido);
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

  /**
   * Ata la suscripción al Usuario recién creado y quema el token.
   *
   * Atómico a propósito: el `WHERE` (mismo token, usuario_id todavía null)
   * es la sección crítica, no una lectura previa. Si dos registros llegan
   * con el mismo token (doble clic, reintento de red tras un timeout), como
   * mucho uno de los dos UPDATE afecta una fila — el otro afecta 0 y su
   * transacción se revierte entera, sin dejar un Usuario sin su plan.
   *
   * @returns {{ reclamada: boolean }}
   */
  static async vincularUsuario(suscripcion, usuarioId, token, transaction) {
    const [filas] = await Suscripcion.update({
      usuario_id: usuarioId,
      token_registro: null,
      token_registro_expira: null,
    }, {
      where: { id: suscripcion.id, token_registro: token, usuario_id: null },
      transaction,
    });
    return { reclamada: filas === 1 };
  }

  /**
   * Recovery Path: busca una compra pagada sin cuenta para un correo YA
   * verificado por OTP (ver POST /api/auth/verify-email) y la reclama.
   *
   * Se llama recién después de que la persona demostró que controla ese
   * correo — conocer el email nunca alcanza por sí solo para reclamar un
   * pago (ver auditoría, punto 7).
   *
   * Ambigüedad = plata: si hay más de una compra reclamable para el mismo
   * correo, no se vincula ninguna automáticamente. Nunca se elige "la más
   * reciente" en silencio — queda para revisión manual (ver notificación en
   * authTracking.service.js: 'subscription_claim_ambiguous').
   *
   * Si es ambigua, además trae las referencias de pago de cada candidata
   * (`pagos`) — lo mínimo que soporte necesita para desambiguar a mano sin
   * exponer nada sensible: referencia, hash_pedido, monto y cuándo se pagó.
   * Nunca claves ni tokens.
   *
   * @returns {{ resultado: 'ninguna'|'reclamada'|'ambigua', suscripcion?: object, candidatas?: object[], pagos?: object[] }}
   */
  static async reclamarPorEmailVerificado({ usuarioId, email, transaction }) {
    const correo = String(email || '').trim().toLowerCase();

    // OJO: `lock` a secas con un `include` rompe contra Postgres real
    // ("FOR UPDATE cannot be applied to the nullable side of an outer
    // join") porque el include de Plan es un LEFT JOIN — esto no lo agarra
    // ningún test con modelos mockeados, porque el mock nunca genera SQL
    // de verdad. `of: Suscripcion` acota el FOR UPDATE a esa tabla sola.
    const candidatas = await Suscripcion.findAll({
      where: { email: correo, estado: 'activa', usuario_id: null },
      include: [Plan],
      lock: { level: transaction.LOCK.UPDATE, of: Suscripcion },
      transaction,
    });

    if (candidatas.length === 0) {
      return { resultado: 'ninguna' };
    }

    if (candidatas.length > 1) {
      const pagos = await PagoSuscripcion.findAll({
        where: { suscripcion_id: candidatas.map(s => s.id), estado: 'PAID' },
        attributes: ['id', 'suscripcion_id', 'referencia', 'hash_pedido', 'monto', 'pagado_en'],
        transaction,
      });
      return { resultado: 'ambigua', candidatas, pagos };
    }

    const [susc] = candidatas;
    const [filas] = await Suscripcion.update({
      usuario_id: usuarioId,
    }, {
      where: { id: susc.id, usuario_id: null },
      transaction,
    });

    if (filas !== 1) {
      // Alguien la reclamó en el mismo instante por otro camino (ej: el
      // happy path con token, corriendo en paralelo). No es un error: esta
      // llamada simplemente no tenía nada para reclamar.
      return { resultado: 'ninguna' };
    }

    await Usuario.update({ plan: susc.Plan?.equivale_plan || 'pago' }, {
      where: { id: usuarioId },
      transaction,
    });

    return { resultado: 'reclamada', suscripcion: susc };
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
      email: data.email,
      nombre: data.nombre,
      telefono: data.telefono,
      documento: data.documento,
      periodo_inicio: data.periodo_inicio,
      periodo_fin: data.periodo_fin,
      plan: data.Plan ? {
        codigo: data.Plan.codigo,
        nombre: data.Plan.nombre,
        precio: data.Plan.precio,
        moneda: ['PYG', 'USD'].includes(data.Plan.moneda) ? data.Plan.moneda : 'PYG',
        periodicidad: data.Plan.periodicidad,
        equivale_plan: data.Plan.equivale_plan,
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
      tiene_plan_pago: suscripcion?.Plan?.equivale_plan === 'pago',
      requiere_pago: !suscripcion || suscripcion?.Plan?.equivale_plan !== 'pago',
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
  static async simularPagoPagopar(usuarioId, planCodigo, afiliadoCodigo = null, { req = null } = {}) {
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

    const afiliado = await AfiliadosService.resolverActivo(afiliadoCodigo);

    const { suscripcion } = await sequelize.transaction(async (t) => {
      await this.sembrarPlanesBase(t);
      const plan = await Plan.findOne({
        where: { codigo: planCodigo, activo: true },
        transaction: t,
      });
      if (!plan) {
        throw Object.assign(new Error('Ese plan no está disponible para contratar en este momento.'), { status: 404 });
      }
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
        afiliado_id: afiliado?.id || null,
        afiliado_codigo: afiliado?.codigo || (afiliadoCodigo || null),
      }, { transaction: t });

      const pago = await PagoSuscripcion.create({
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

      await AfiliadosService.crearComisionPorPago(pago, t);

      await usuario.update({ plan: 'pago' }, { transaction: t });

      return { suscripcion };
    });

    const completa = await Suscripcion.findByPk(suscripcion.id, { include: [Plan] });
    await AuthTracking.registrarEventoConNotificacion({
      tipo: 'subscription_payment_paid',
      req,
      usuario,
      email: usuario.correo_electronico,
      metadata: {
        origen: 'PagoPar dummy',
        suscripcion_id: completa.id,
        monto: Number(completa.precio_pagado || 0),
        moneda: ['PYG', 'USD'].includes(completa.Plan?.moneda) ? completa.Plan.moneda : 'PYG',
        plan_codigo: completa.Plan?.codigo || planCodigo,
        plan_nombre: completa.Plan?.nombre || null,
      },
    });
    return {
      ya_estaba_activa: false,
      suscripcion: this.serializarSuscripcion(completa),
      estado_cuenta: await this.estadoCuenta(usuarioId),
    };
  }
}

module.exports = SuscripcionService;
