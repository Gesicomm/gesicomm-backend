const { Op, QueryTypes } = require('sequelize');
const {
  AuthEvent,
  UserSession,
  AuthNotification,
  Usuario,
  PagoSuscripcion,
  Suscripcion,
  Plan,
  PaymentTransaction,
  Envio,
  EnvioItem,
  EnvioItemComponente,
  Producto,
  Proveedor,
  sequelize,
} = require('../models');
const parametros = require('./parametros.service');
const PagoParService = require('./payments/pagoParService');

const SESSION_COOKIE = 'authSessionId';
const VENTANA_ACTIVA_MS = 15 * 60 * 1000;

const EVENTOS_NOTIFICABLES = {
  register: {
    titulo: 'Nuevo registro',
    mensaje: ({ nombre, email }) => `${nombre || email || 'Un usuario'} creó una cuenta.`,
  },
  email_verified: {
    titulo: 'Correo verificado',
    mensaje: ({ nombre, email }) => `${nombre || email || 'Un usuario'} activó su cuenta.`,
  },
  login_success: {
    titulo: 'Nuevo login',
    mensaje: ({ nombre, email }) => `${nombre || email || 'Un usuario'} inició sesión.`,
  },
  onboarding_started: {
    titulo: 'Onboarding iniciado',
    mensaje: ({ nombre, email }) => `${nombre || email || 'Un usuario'} empezó a configurar su tienda.`,
  },
  onboarding_store_created: {
    titulo: 'Tienda creada',
    mensaje: ({ nombre, email }) => `${nombre || email || 'Un usuario'} creó la base de su tienda.`,
  },
  onboarding_skipped: {
    titulo: 'Onboarding saltado',
    mensaje: ({ nombre, email }) => `${nombre || email || 'Un usuario'} eligió configurar su tienda más tarde.`,
  },
  onboarding_landing_generated: {
    titulo: 'Landing generada',
    mensaje: ({ nombre, email }) => `${nombre || email || 'Un usuario'} generó su landing inicial desde onboarding.`,
  },
  subscription_payment_paid: {
    titulo: 'Plan pagado',
    mensaje: ({ nombre, email, metadata }) => {
      const plan = metadata?.plan_nombre || metadata?.plan_codigo || 'un plan';
      const monto = metadata?.monto != null ? ` por ${metadata.moneda || 'USD'} ${metadata.monto}` : '';
      return `${nombre || email || 'Un usuario'} pagó ${plan}${monto}.`;
    },
  },
  store_order_payment_paid: {
    titulo: 'Pedido pagado online',
    mensaje: ({ nombre, email, metadata }) => {
      const pedido = metadata?.numero_pedido || metadata?.envio_id || 'un pedido';
      return `${nombre || email || 'Un comercio'} recibió pago online del pedido #${pedido}.`;
    },
  },
  stock_payment_paid: {
    titulo: 'Abastecimiento pagado',
    mensaje: ({ nombre, email, metadata }) => {
      const pedido = metadata?.numero_pedido || metadata?.envio_id || 'un pedido';
      return `${nombre || email || 'Un comercio'} pagó el abastecimiento del pedido #${pedido}.`;
    },
  },
};

function emailNormalizado(email) {
  return email ? String(email).trim().toLowerCase() : null;
}

function datosRequest(req) {
  const forwardedFor = req.headers?.['x-forwarded-for'];
  const ip = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : String(forwardedFor || req.ip || '').split(',')[0].trim();

  return {
    ip: ip || null,
    user_agent: req.headers?.['user-agent'] || null,
  };
}

async function crearNotificacion(evento, usuario) {
  const config = EVENTOS_NOTIFICABLES[evento.tipo];
  if (!config) return null;

  const datos = {
    nombre: usuario?.nombre || null,
    email: evento.email,
    metadata: evento.metadata || {},
  };

  return AuthNotification.create({
    tipo: evento.tipo,
    titulo: config.titulo,
    mensaje: config.mensaje(datos),
    usuario_id: usuario?.id || evento.usuario_id || null,
    auth_event_id: evento.id,
    metadata: {
      email: evento.email,
      ip: evento.ip,
      session_id: evento.session_id,
      ...(evento.metadata || {}),
    },
  });
}

async function registrarEvento({ tipo, req, usuario = null, email = null, resultado = 'ok', sessionId = null, metadata = {}, transaction = null }) {
  try {
    const request = datosRequest(req);
    const evento = await AuthEvent.create({
      usuario_id: usuario?.id || null,
      email: emailNormalizado(email || usuario?.correo_electronico || usuario?.email),
      tipo,
      resultado,
      ip: request.ip,
      user_agent: request.user_agent,
      session_id: sessionId,
      metadata,
    }, { transaction });

    return evento;
  } catch (err) {
    console.error('[auth-tracking] No se pudo registrar evento:', err.message);
    return null;
  }
}

async function registrarEventoConNotificacion({ tipo, req, usuario = null, email = null, resultado = 'ok', sessionId = null, metadata = {} }) {
  const evento = await registrarEvento({ tipo, req, usuario, email, resultado, sessionId, metadata });
  if (evento) {
    await crearNotificacion(evento, usuario).catch(() => null);
  }
  return evento;
}

async function iniciarSesion({ req, usuario }) {
  try {
    const request = datosRequest(req);
    const sesion = await UserSession.create({
      usuario_id: usuario.id,
      ip: request.ip,
      user_agent: request.user_agent,
      estado: 'activa',
    });

    await registrarEventoConNotificacion({
      tipo: 'login_success',
      req,
      usuario,
      sessionId: sesion.id,
    });

    return sesion;
  } catch (err) {
    console.error('[auth-tracking] No se pudo iniciar sesión auditada:', err.message);
    return null;
  }
}

async function marcarActividad(req, usuarioId) {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (!sessionId || !usuarioId) return null;

  try {
    const [actualizadas] = await UserSession.update({
      last_seen_at: new Date(),
    }, {
      where: {
        id: sessionId,
        usuario_id: usuarioId,
        estado: 'activa',
        ended_at: null,
      },
    });

    return actualizadas > 0 ? sessionId : null;
  } catch (err) {
    return null;
  }
}

async function cerrarSesion(req, usuarioId = null) {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (!sessionId) return null;

  try {
    const where = { id: sessionId, ended_at: null };
    if (usuarioId) where.usuario_id = usuarioId;

    await UserSession.update({
      estado: 'cerrada',
      ended_at: new Date(),
      last_seen_at: new Date(),
    }, { where });

    return sessionId;
  } catch (err) {
    return null;
  }
}

function rangoDias(dias) {
  const n = Math.max(1, Math.min(Number(dias) || 30, 90));
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function ymd(fecha) {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function numeroPagina(pagina) {
  return Math.max(1, Number.parseInt(pagina, 10) || 1);
}

function filtroFecha(where, filtros = {}, campo = 'created_at') {
  const rango = {};
  if (filtros.desde) {
    const desde = new Date(filtros.desde);
    if (!Number.isNaN(desde.getTime())) rango[Op.gte] = desde;
  }
  if (filtros.hasta) {
    const hasta = new Date(filtros.hasta);
    if (!Number.isNaN(hasta.getTime())) rango[Op.lte] = hasta;
  }
  if (Object.keys(rango).length > 0) {
    where[campo] = {
      ...(where[campo] || {}),
      ...rango,
    };
  }
}

function busquedaTexto(valor) {
  const limpio = String(valor || '').trim();
  return limpio.length >= 2 ? `%${limpio}%` : null;
}

function respuestaPaginada({ rows, count }, pagina) {
  const limite = 10;
  const total = Number(count) || 0;
  return {
    items: rows,
    paginacion: {
      pagina,
      limite,
      total,
      paginas: Math.max(1, Math.ceil(total / limite)),
      tiene_siguiente: pagina * limite < total,
      tiene_anterior: pagina > 1,
    },
  };
}

async function buscarPaginado(Modelo, opciones, pagina) {
  const limite = 10;
  const page = numeroPagina(pagina);
  const resultado = await Modelo.findAndCountAll({
    ...opciones,
    limit: limite,
    offset: (page - 1) * limite,
    distinct: true,
    subQuery: false,
  });
  return respuestaPaginada(resultado, page);
}

async function resumen({ dias = 30 } = {}) {
  const desde = rangoDias(dias);
  const desde24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const activoDesde = new Date(Date.now() - VENTANA_ACTIVA_MS);

  const [
    usuariosTotal,
    usuariosVerificados,
    registrosPeriodo,
    loginsPeriodo,
    onboardingIniciadosPeriodo,
    onboardingLandingPeriodo,
    onboardingSaltadosPeriodo,
    pagosPlanPeriodo,
    pagosPedidosPeriodo,
    pagosAbastecimientoPeriodo,
    fallosPeriodo,
    sesionesActivas,
    notificacionesNoLeidas,
    serie,
  ] = await Promise.all([
    Usuario.count(),
    Usuario.count({ where: { email_verificado: true } }),
    AuthEvent.count({ where: { tipo: 'register', created_at: { [Op.gte]: desde } } }),
    AuthEvent.count({ where: { tipo: 'login_success', created_at: { [Op.gte]: desde } } }),
    AuthEvent.count({ where: { tipo: 'onboarding_started', created_at: { [Op.gte]: desde } } }),
    AuthEvent.count({ where: { tipo: 'onboarding_landing_generated', created_at: { [Op.gte]: desde } } }),
    AuthEvent.count({ where: { tipo: 'onboarding_skipped', created_at: { [Op.gte]: desde } } }),
    AuthEvent.count({ where: { tipo: 'subscription_payment_paid', created_at: { [Op.gte]: desde } } }),
    AuthEvent.count({ where: { tipo: 'store_order_payment_paid', created_at: { [Op.gte]: desde } } }),
    AuthEvent.count({ where: { tipo: 'stock_payment_paid', created_at: { [Op.gte]: desde } } }),
    AuthEvent.count({ where: { resultado: 'fallo', created_at: { [Op.gte]: desde } } }),
    UserSession.count({ where: { estado: 'activa', ended_at: null, last_seen_at: { [Op.gte]: activoDesde } } }),
    AuthNotification.count({ where: { leida: false } }),
    sequelize.query(`
      SELECT
        to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS fecha,
        COUNT(*) FILTER (WHERE tipo = 'register')::int AS registros,
        COUNT(*) FILTER (WHERE tipo = 'email_verified')::int AS verificaciones,
        COUNT(*) FILTER (WHERE tipo = 'login_success')::int AS logins,
        COUNT(*) FILTER (WHERE tipo = 'onboarding_started')::int AS onboarding_started,
        COUNT(*) FILTER (WHERE tipo = 'onboarding_landing_generated')::int AS onboarding_landing_generated,
        COUNT(*) FILTER (WHERE tipo = 'subscription_payment_paid')::int AS subscription_payment_paid,
        COUNT(*) FILTER (WHERE tipo = 'store_order_payment_paid')::int AS store_order_payment_paid,
        COUNT(*) FILTER (WHERE tipo = 'stock_payment_paid')::int AS stock_payment_paid,
        COUNT(*) FILTER (WHERE resultado = 'fallo')::int AS fallos
      FROM auth_events
      WHERE created_at >= :desde
      GROUP BY 1
      ORDER BY 1 ASC
    `, { replacements: { desde }, type: QueryTypes.SELECT }),
  ]);

  return {
    usuarios_total: usuariosTotal,
    usuarios_verificados: usuariosVerificados,
    usuarios_pendientes: Math.max(usuariosTotal - usuariosVerificados, 0),
    registros_periodo: registrosPeriodo,
    logins_periodo: loginsPeriodo,
    onboarding_iniciados_periodo: onboardingIniciadosPeriodo,
    onboarding_landings_periodo: onboardingLandingPeriodo,
    onboarding_saltados_periodo: onboardingSaltadosPeriodo,
    pagos_plan_periodo: pagosPlanPeriodo,
    pagos_pedidos_periodo: pagosPedidosPeriodo,
    pagos_abastecimiento_periodo: pagosAbastecimientoPeriodo,
    fallos_periodo: fallosPeriodo,
    sesiones_activas: sesionesActivas,
    notificaciones_no_leidas: notificacionesNoLeidas,
    nuevos_registros_24h: await AuthEvent.count({ where: { tipo: 'register', created_at: { [Op.gte]: desde24h } } }),
    nuevos_logins_24h: await AuthEvent.count({ where: { tipo: 'login_success', created_at: { [Op.gte]: desde24h } } }),
    nuevos_onboarding_24h: await AuthEvent.count({ where: { tipo: 'onboarding_started', created_at: { [Op.gte]: desde24h } } }),
    nuevos_pagos_plan_24h: await AuthEvent.count({ where: { tipo: 'subscription_payment_paid', created_at: { [Op.gte]: desde24h } } }),
    nuevos_pagos_pedidos_24h: await AuthEvent.count({ where: { tipo: 'store_order_payment_paid', created_at: { [Op.gte]: desde24h } } }),
    nuevos_pagos_abastecimiento_24h: await AuthEvent.count({ where: { tipo: 'stock_payment_paid', created_at: { [Op.gte]: desde24h } } }),
    serie,
  };
}

function filaResumenPago(tipo, label) {
  return {
    tipo,
    label,
    cantidad_total: 0,
    monto_bruto_total: 0,
    comision_total: 0,
    monto_neto_total: 0,
    estados: {
      PENDING: { cantidad: 0, bruto: 0, comision: 0, neto: 0 },
      PAID: { cantidad: 0, bruto: 0, comision: 0, neto: 0 },
      FAILED: { cantidad: 0, bruto: 0, comision: 0, neto: 0 },
    },
  };
}

function payloadPagoPar(valor) {
  if (!valor) return null;
  const raiz = valor.resultado && Array.isArray(valor.resultado) ? valor.resultado[0] : valor;
  return raiz && typeof raiz === 'object' ? raiz : null;
}

function normalizarTexto(valor) {
  return String(valor || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function obtenerReglasComisionPagoPar() {
  const valores = await parametros.obtenerVarios([
    'PAGOPAR_PUBLIC_KEY',
    'PAGOPAR_PRIVATE_KEY',
    'PAGOPAR_COMISION_FALLBACK_PCT',
    'PAGOPAR_COMISIONES_JSON',
  ]);

  const reglas = new Map();
  let fallbackPct = Number(valores.PAGOPAR_COMISION_FALLBACK_PCT);
  if (!Number.isFinite(fallbackPct)) fallbackPct = 0;
  let origen = fallbackPct > 0 ? 'parametros' : 'sin_configurar';

  if (valores.PAGOPAR_COMISIONES_JSON) {
    try {
      const parsed = JSON.parse(valores.PAGOPAR_COMISIONES_JSON);
      Object.entries(parsed || {}).forEach(([clave, pct]) => {
        const n = Number(pct);
        if (Number.isFinite(n)) reglas.set(normalizarTexto(clave), n);
      });
    } catch {
      // Se ignora: el fallback y/o PagoPar siguen cubriendo el cálculo.
    }
  }

  if (valores.PAGOPAR_PUBLIC_KEY && valores.PAGOPAR_PRIVATE_KEY) {
    try {
      const datos = await PagoParService.obtenerDatosComercio({
        public_key: valores.PAGOPAR_PUBLIC_KEY,
        private_key: valores.PAGOPAR_PRIVATE_KEY,
      });
      const pctGeneral = Number(datos.porcentaje_comision);
      if (Number.isFinite(pctGeneral)) fallbackPct = pctGeneral;
      for (const forma of datos.forma_pago || []) {
        const pct = Number(forma.porcentaje_comision ?? pctGeneral);
        if (!Number.isFinite(pct)) continue;
        if (forma.forma_pago) reglas.set(normalizarTexto(forma.forma_pago), pct);
        if (forma.tipo) reglas.set(normalizarTexto(forma.tipo), pct);
      }
      origen = 'pagopar';
    } catch (error) {
      origen = fallbackPct > 0 || reglas.size > 0 ? 'parametros' : 'sin_configurar';
    }
  }

  return { fallbackPct, reglas, origen };
}

function porcentajeComisionParaPago(datos, reglasComision) {
  const payload = payloadPagoPar(datos);
  const candidatos = [
    payload?.forma_pago_identificador,
    payload?.forma_pago,
    payload?.forma_pago?.forma_pago,
    payload?.forma_pago?.tipo,
  ].filter(Boolean).map(normalizarTexto);

  for (const candidato of candidatos) {
    if (reglasComision.reglas.has(candidato)) return reglasComision.reglas.get(candidato);
    for (const [clave, pct] of reglasComision.reglas.entries()) {
      if (clave && (candidato.includes(clave) || clave.includes(candidato))) return pct;
    }
  }
  return reglasComision.fallbackPct || 0;
}

function sumarPago(resumen, { tipo, estado, monto, respuestaPasarela }, reglasComision) {
  const estadoNormalizado = ['PENDING', 'PAID', 'FAILED'].includes(estado) ? estado : 'PENDING';
  const bruto = Math.max(0, Math.round(Number(monto) || 0));
  const pct = estadoNormalizado === 'PAID' ? porcentajeComisionParaPago(respuestaPasarela, reglasComision) : 0;
  const comision = Math.round(bruto * (pct / 100));
  const neto = Math.max(0, bruto - comision);

  resumen.cantidad_total += 1;
  resumen.monto_bruto_total += bruto;
  resumen.comision_total += comision;
  resumen.monto_neto_total += neto;
  resumen.estados[estadoNormalizado].cantidad += 1;
  resumen.estados[estadoNormalizado].bruto += bruto;
  resumen.estados[estadoNormalizado].comision += comision;
  resumen.estados[estadoNormalizado].neto += neto;
}

async function resumenPagosAdmin({ dias = 30 } = {}) {
  const desde = rangoDias(dias);
  const reglasComision = await obtenerReglasComisionPagoPar();
  const porTipo = {
    suscripciones: filaResumenPago('suscripciones', 'Suscripciones'),
    abastecimiento: filaResumenPago('abastecimiento', 'Abastecimiento'),
  };

  const totales = filaResumenPago('total', 'Total Gesicomm');

  const [pagosSuscripciones, pagosAbastecimiento] = await Promise.all([
    PagoSuscripcion.findAll({
      where: { created_at: { [Op.gte]: desde } },
      attributes: ['estado', 'monto', 'respuesta_pasarela'],
    }),
    PaymentTransaction.findAll({
      where: {
        created_at: { [Op.gte]: desde },
        [Op.and]: sequelize.where(sequelize.json('metadata.tipo'), 'abastecimiento_gesicom'),
      },
      attributes: ['status', 'amount', 'metadata'],
    }),
  ]);

  for (const pago of pagosSuscripciones) {
    sumarPago(porTipo.suscripciones, {
      tipo: 'suscripciones',
      estado: pago.estado,
      monto: pago.monto,
      respuestaPasarela: pago.respuesta_pasarela,
    }, reglasComision);
    sumarPago(totales, {
      tipo: 'total',
      estado: pago.estado,
      monto: pago.monto,
      respuestaPasarela: pago.respuesta_pasarela,
    }, reglasComision);
  }

  for (const pago of pagosAbastecimiento) {
    const respuestaPasarela = pago.metadata?.respuesta_pasarela || null;
    sumarPago(porTipo.abastecimiento, {
      tipo: 'abastecimiento',
      estado: pago.status,
      monto: pago.amount,
      respuestaPasarela,
    }, reglasComision);
    sumarPago(totales, {
      tipo: 'total',
      estado: pago.status,
      monto: pago.amount,
      respuestaPasarela,
    }, reglasComision);
  }

  return {
    periodo_dias: Math.max(1, Math.min(Number(dias) || 30, 90)),
    moneda: 'PYG',
    comision_pasarela: {
      origen: reglasComision.origen,
      fallback_pct: reglasComision.fallbackPct,
    },
    totales,
    tipos: Object.values(porTipo),
  };
}

async function listarPagosSuscripcion({ pagina = 1, filtros = {} } = {}) {
  const where = {};
  if (filtros.estado && filtros.estado !== 'todos') where.estado = filtros.estado;
  filtroFecha(where, filtros, 'created_at');

  const reglasComision = await obtenerReglasComisionPagoPar();
  const paginaPagos = await buscarPaginado(PagoSuscripcion, {
    where,
    order: [['created_at', 'DESC']],
    include: [{
      model: Suscripcion,
      attributes: ['id', 'email', 'nombre', 'telefono', 'documento', 'estado', 'usuario_id'],
      include: [{ model: Plan, attributes: ['id', 'codigo', 'nombre'] }],
    }],
  }, pagina);

  paginaPagos.items = (paginaPagos.items || []).map((pago) => {
    const data = pago.toJSON ? pago.toJSON() : pago;
    const bruto = Math.max(0, Math.round(Number(data.monto) || 0));
    const pct = data.estado === 'PAID' ? porcentajeComisionParaPago(data.respuesta_pasarela, reglasComision) : 0;
    const comision = Math.round(bruto * (pct / 100));
    return {
      ...data,
      monto_bruto: bruto,
      comision_pasarela_pct: pct,
      comision_pasarela_monto: comision,
      monto_neto: Math.max(0, bruto - comision),
    };
  });

  return paginaPagos;
}

async function topProductosAdmin({ dias = 30, limite = 8 } = {}) {
  const desde = rangoDias(dias);
  const desdeStr = ymd(desde);
  const filas = await EnvioItem.findAll({
    attributes: ['id', 'producto_id', 'nombre_producto', 'cantidad', 'precio_unitario', 'subtotal'],
    include: [
      {
        model: Envio,
        attributes: ['id', 'estado', 'monto', 'fecha', 'dispatchedAt'],
        required: true,
        where: {
          estado: { [Op.iLike]: 'entregado' },
          [Op.or]: [
            { dispatchedAt: { [Op.gte]: desdeStr } },
            { fecha: { [Op.gte]: desdeStr } },
          ],
        },
      },
      {
        model: Producto,
        attributes: ['id', 'nombre', 'sku', 'precio_costo', 'precio_base'],
        required: false,
        include: [{ model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre'], required: false }],
      },
      {
        model: EnvioItemComponente,
        as: 'componentes_vendidos',
        attributes: ['producto_id', 'cantidad', 'costo_unitario'],
        required: false,
        include: [{
          model: Producto,
          as: 'producto',
          attributes: ['id', 'nombre', 'sku', 'precio_costo', 'precio_base'],
          required: false,
          include: [{ model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre'], required: false }],
        }],
      },
    ],
    order: [['created_at', 'DESC']],
  });

  const mapa = new Map();

  for (const item of filas) {
    const data = item.toJSON ? item.toJSON() : item;
    const cantidadItem = Number(data.cantidad || 1);
    const componentes = data.componentes_vendidos || [];

    if (componentes.length > 0) {
      for (const comp of componentes) {
        const producto = comp.producto || data.Producto || null;
        const cantidad = Math.max(0, Number(comp.cantidad || 0));
        // Dashboard admin = margen mayorista Gesicomm:
        // - venta: lo que la tienda le paga a Gesicomm por abastecimiento
        //   (snapshot costo_unitario para el comerciante).
        // - costo: lo que Gesicomm pagó al proveedor (precio_costo admin).
        // Nunca usar EnvioItem.subtotal/precio_unitario acá: ese es el
        // precio retail que la tienda cobró al cliente final.
        const ventaUnitarioTienda = Number(comp.costo_unitario || producto?.precio_base || 0);
        const costoUnitarioAdmin = Number(producto?.precio_costo || 0);
        sumarProductoRanking(mapa, {
          producto,
          productoId: comp.producto_id || producto?.id || data.producto_id,
          nombre: producto?.nombre || data.nombre_producto,
          proveedor: producto?.proveedor || null,
          cantidad,
          venta: Math.round(ventaUnitarioTienda * cantidad),
          costo: Math.round(costoUnitarioAdmin * cantidad),
        });
      }
    } else {
      const producto = data.Producto || null;
      const ventaUnitarioTienda = Number(producto?.precio_base || data.precio_unitario || 0);
      const costoUnitarioAdmin = Number(producto?.precio_costo || 0);
      sumarProductoRanking(mapa, {
        producto,
        productoId: data.producto_id || producto?.id || null,
        nombre: producto?.nombre || data.nombre_producto,
        proveedor: producto?.proveedor || null,
        cantidad: cantidadItem,
        venta: Math.round(ventaUnitarioTienda * cantidadItem),
        costo: Math.round(costoUnitarioAdmin * cantidadItem),
      });
    }
  }

  const productos = Array.from(mapa.values())
    .map((p) => ({
      ...p,
      ganancia: p.venta_total - p.costo_total,
      margen_pct: p.venta_total > 0 ? Number((((p.venta_total - p.costo_total) / p.venta_total) * 100).toFixed(1)) : 0,
      precio_venta_promedio: p.unidades > 0 ? Math.round(p.venta_total / p.unidades) : 0,
      costo_promedio: p.unidades > 0 ? Math.round(p.costo_total / p.unidades) : 0,
    }))
    .sort((a, b) => b.unidades - a.unidades)
    .slice(0, Math.max(1, Math.min(Number(limite) || 8, 20)));

  const totales = productos.reduce((acc, p) => ({
    unidades: acc.unidades + p.unidades,
    venta_total: acc.venta_total + p.venta_total,
    costo_total: acc.costo_total + p.costo_total,
    ganancia: acc.ganancia + p.ganancia,
  }), { unidades: 0, venta_total: 0, costo_total: 0, ganancia: 0 });

  return {
    periodo_dias: Math.max(1, Math.min(Number(dias) || 30, 90)),
    moneda: 'PYG',
    productos,
    totales,
  };
}

function sumarProductoRanking(mapa, { producto, productoId, nombre, proveedor, cantidad, venta, costo }) {
  const clave = productoId ? `p_${productoId}` : `name_${nombre}`;
  if (!mapa.has(clave)) {
    mapa.set(clave, {
      producto_id: productoId || null,
      nombre: nombre || 'Producto',
      sku: producto?.sku || null,
      proveedor: proveedor ? { id: proveedor.id, nombre: proveedor.nombre } : null,
      unidades: 0,
      venta_total: 0,
      costo_total: 0,
    });
  }
  const row = mapa.get(clave);
  row.unidades += Math.max(0, Number(cantidad || 0));
  row.venta_total += Math.max(0, Math.round(Number(venta || 0)));
  row.costo_total += Math.max(0, Math.round(Number(costo || 0)));
}

async function listarEventos({ pagina = 1, filtros = {} } = {}) {
  const where = {};
  if (Array.isArray(filtros.tipos) && filtros.tipos.length) {
    where.tipo = { [Op.in]: filtros.tipos.map(t => String(t)).filter(Boolean) };
  } else if (filtros.tipo && filtros.tipo !== 'todos') {
    where.tipo = filtros.tipo;
  }
  if (filtros.resultado && filtros.resultado !== 'todos') where.resultado = filtros.resultado;
  if (filtros.usuario_id) where.usuario_id = Number(filtros.usuario_id);
  if (filtros.ip) where.ip = { [Op.iLike]: busquedaTexto(filtros.ip) || String(filtros.ip) };
  if (filtros.busqueda) {
    const q = busquedaTexto(filtros.busqueda);
    if (q) {
      where[Op.or] = [
        { email: { [Op.iLike]: q } },
        { ip: { [Op.iLike]: q } },
        { tipo: { [Op.iLike]: q } },
        { '$usuario.nombre$': { [Op.iLike]: q } },
        { '$usuario.correo_electronico$': { [Op.iLike]: q } },
      ];
    }
  }
  filtroFecha(where, filtros, 'created_at');

  return buscarPaginado(AuthEvent, {
    where,
    order: [['created_at', 'DESC']],
    include: [{ model: Usuario, as: 'usuario', attributes: ['id', 'nombre', 'correo_electronico', 'email_verificado', 'plan'] }],
  }, pagina);
}

async function listarSesionesActivas({ pagina = 1, filtros = {} } = {}) {
  const activoDesde = new Date(Date.now() - VENTANA_ACTIVA_MS);
  const where = {};
  const soloActivas = filtros.solo_activas !== false;

  if (soloActivas) {
    where.estado = 'activa';
    where.ended_at = null;
    where.last_seen_at = { [Op.gte]: activoDesde };
  } else if (filtros.estado && filtros.estado !== 'todos') {
    where.estado = filtros.estado;
  }
  if (filtros.usuario_id) where.usuario_id = Number(filtros.usuario_id);
  if (filtros.ip) where.ip = { [Op.iLike]: busquedaTexto(filtros.ip) || String(filtros.ip) };
  filtroFecha(where, filtros, 'last_seen_at');

  const usuarioWhere = {};
  const q = busquedaTexto(filtros.busqueda);
  if (q) {
    usuarioWhere[Op.or] = [
      { nombre: { [Op.iLike]: q } },
      { correo_electronico: { [Op.iLike]: q } },
    ];
  }

  return buscarPaginado(UserSession, {
    where,
    order: [['last_seen_at', 'DESC']],
    include: [{
      model: Usuario,
      as: 'usuario',
      attributes: ['id', 'nombre', 'correo_electronico', 'email_verificado', 'plan'],
      ...(Object.keys(usuarioWhere).length > 0 ? { where: usuarioWhere } : {}),
    }],
  }, pagina);
}

async function listarNotificaciones({ pagina = 1, filtros = {} } = {}) {
  const where = {};
  if (filtros.solo_no_leidas === true) where.leida = false;
  if (typeof filtros.leida === 'boolean') where.leida = filtros.leida;
  if (Array.isArray(filtros.tipos) && filtros.tipos.length) {
    where.tipo = { [Op.in]: filtros.tipos.map(t => String(t)).filter(Boolean) };
  } else if (filtros.tipo && filtros.tipo !== 'todos') {
    where.tipo = filtros.tipo;
  }
  if (filtros.usuario_id) where.usuario_id = Number(filtros.usuario_id);
  if (filtros.busqueda) {
    const q = busquedaTexto(filtros.busqueda);
    if (q) {
      where[Op.or] = [
        { titulo: { [Op.iLike]: q } },
        { mensaje: { [Op.iLike]: q } },
        { '$usuario.nombre$': { [Op.iLike]: q } },
        { '$usuario.correo_electronico$': { [Op.iLike]: q } },
      ];
    }
  }
  filtroFecha(where, filtros, 'created_at');

  return buscarPaginado(AuthNotification, {
    where,
    order: [['created_at', 'DESC']],
    include: [{ model: Usuario, as: 'usuario', attributes: ['id', 'nombre', 'correo_electronico'] }],
  }, pagina);
}

async function marcarNotificacionesLeidas(ids = null) {
  const where = { leida: false };
  if (Array.isArray(ids) && ids.length > 0) {
    where.id = { [Op.in]: ids.map(Number).filter(Boolean) };
  }

  const [actualizadas] = await AuthNotification.update({ leida: true }, { where });
  return { actualizadas };
}

module.exports = {
  SESSION_COOKIE,
  registrarEvento,
  registrarEventoConNotificacion,
  iniciarSesion,
  marcarActividad,
  cerrarSesion,
  resumen,
  resumenPagosAdmin,
  listarPagosSuscripcion,
  topProductosAdmin,
  listarEventos,
  listarSesionesActivas,
  listarNotificaciones,
  marcarNotificacionesLeidas,
};
