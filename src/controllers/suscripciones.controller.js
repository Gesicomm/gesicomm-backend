const { PagoSuscripcion } = require('../models');
const SuscripcionService = require('../services/suscripcion.service');
const PagoParService = require('../services/payments/pagoParService');
const parametros = require('../services/parametros.service');
const { logger } = require('../utils/logger');

const AFILIADOS_DEFAULT = {
  activo: true,
  comision_pct: 40,
  recurrencia: 'Recurrente mientras el cliente referido permanezca activo y al dia.',
  base_comisionable: 'Suscripcion SaaS elegible efectivamente cobrada por Gesicom.',
  exclusiones: [
    'Autorreferidos.',
    'Cancelaciones, devoluciones y contracargos.',
    'Servicios adicionales, implementaciones, consumos, impuestos u otros conceptos no SaaS.',
  ],
  condiciones: [
    'La comision se calcula solo sobre pagos cobrados.',
    'El cliente referido debe permanecer activo y con pagos al dia.',
    'Gesicom puede ajustar reglas operativas del programa y comunicar cambios relevantes.',
  ],
};

function listaLimpia(valor, fallback) {
  const entrada = Array.isArray(valor) ? valor : fallback;
  return entrada.map(v => String(v || '').trim()).filter(Boolean);
}

function normalizarAfiliadosConfig(payload = {}) {
  const comision = Number(payload.comision_pct ?? AFILIADOS_DEFAULT.comision_pct);
  return {
    ...AFILIADOS_DEFAULT,
    ...payload,
    activo: payload.activo !== undefined ? !!payload.activo : AFILIADOS_DEFAULT.activo,
    comision_pct: Math.max(0, Math.min(100, Number.isFinite(comision) ? comision : AFILIADOS_DEFAULT.comision_pct)),
    recurrencia: String(payload.recurrencia || AFILIADOS_DEFAULT.recurrencia).trim(),
    base_comisionable: String(payload.base_comisionable || AFILIADOS_DEFAULT.base_comisionable).trim(),
    exclusiones: listaLimpia(payload.exclusiones, AFILIADOS_DEFAULT.exclusiones),
    condiciones: listaLimpia(payload.condiciones, AFILIADOS_DEFAULT.condiciones),
  };
}

/** GET /api/planes — catálogo público. */
exports.listarPlanes = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json(await SuscripcionService.listarPlanesPagos());
  } catch (error) {
    console.error('[Suscripciones] Error al listar planes:', error);
    res.status(500).json({ error: 'No se pudieron cargar los planes.' });
  }
};

/** GET /api/config/payment-gateways/planes — catálogo completo para admin. */
exports.listarPlanesAdmin = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json(await SuscripcionService.listarPlanesAdmin());
  } catch (error) {
    console.error('[Planes Admin] Error al listar planes:', error);
    res.status(500).json({ message: 'No se pudieron cargar los planes.' });
  }
};

/** PUT /api/config/payment-gateways/planes — guarda catálogo comercial. */
exports.guardarPlanesAdmin = async (req, res) => {
  try {
    const planes = await SuscripcionService.guardarPlanesAdmin(req.body?.planes || req.body);
    res.json(planes);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('[Planes Admin] Error al guardar planes:', error);
    res.status(status).json({ message: error.message || 'No se pudieron guardar los planes.' });
  }
};

/** DELETE /api/config/payment-gateways/planes/:codigo — borra un plan sin uso. */
exports.eliminarPlanAdmin = async (req, res) => {
  try {
    const planes = await SuscripcionService.eliminarPlanAdmin(req.params.codigo);
    res.json(planes);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('[Planes Admin] Error al borrar plan:', error);
    res.status(status).json({ message: error.message || 'No se pudo borrar el plan.' });
  }
};

/** GET /api/suscripciones/mi-estado — estado de pago de la cuenta logueada. */
exports.miEstado = async (req, res) => {
  try {
    return res.json(await SuscripcionService.estadoCuenta(req.usuario.id));
  } catch (error) {
    console.error('[Suscripciones] Error al consultar mi estado:', error);
    return res.status(500).json({ message: 'No se pudo consultar el estado de tu plan.' });
  }
};

/** POST /api/suscripciones/checkout — arranca el pago de un plan. */
exports.iniciarCheckout = async (req, res) => {
  try {
    const { plan_codigo, email, nombre, telefono, documento, afiliado_codigo, checkout_intent_token } = req.body || {};
    if (req.body?.affiliate_id !== undefined) {
      logger.warn({
        mensaje: '[Checkout] Payload intentó setear affiliate_id desde frontend. Campo ignorado.',
        email,
        plan_codigo,
      });
    }
    const resultado = await SuscripcionService.iniciarCheckout({ plan_codigo, email, nombre, telefono, documento, afiliado_codigo, checkout_intent_token });
    res.json(resultado);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('[Suscripciones] Error en checkout:', error);
    res.status(status).json({ error: error.message || 'No se pudo iniciar el pago.' });
  }
};

/** POST /api/suscripciones/checkout-intents — fija plan y afiliado candidato. */
exports.crearCheckoutIntent = async (req, res) => {
  try {
    const { plan_codigo, afiliado_codigo } = req.body || {};
    const resultado = await SuscripcionService.crearCheckoutIntent({ plan_codigo, afiliado_codigo });
    res.status(201).json(resultado);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('[Suscripciones] Error creando checkout intent:', error);
    res.status(status).json({ error: error.message || 'No se pudo preparar la selección del plan.' });
  }
};

/** GET /api/suscripciones/estado/:hash — para la pantalla de resultado. */
exports.estadoPago = async (req, res) => {
  try {
    const estado = await SuscripcionService.consultarYReconciliarPagoPorHash(req.params.hash, {
      req,
      origen: 'PagoPar consulta resultado suscripción',
    });
    if (!estado) return res.status(404).json({ error: 'No encontramos ese pago.' });
    res.json(estado);
  } catch (error) {
    console.error('[Suscripciones] Error al consultar estado:', error);
    res.status(500).json({ error: 'No se pudo consultar el estado del pago.' });
  }
};

/**
 * POST /api/webhooks/pagopar/suscripciones — callback de PagoPar.
 *
 * Deliberadamente separado del webhook de pedidos de tienda: aquel resuelve
 * un Envio y descuenta stock; este acredita una suscripción. Mezclarlos
 * obligaría a adivinar de qué tipo de cobro se trata en cada aviso.
 *
 * Mismo formato de payload y misma firma que el otro:
 *   sha1(private_key + hash_pedido)
 * pero contra la private key DEL SISTEMA, no la de un comercio.
 */
exports.webhookSuscripciones = async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Cuerpo del webhook inválido.' });
    }
    // Se acepta el objeto plano documentado y también el envoltorio resultado[].
    const raiz = Array.isArray(body.resultado) ? body.resultado[0] : body;
    if (!raiz || typeof raiz !== 'object') {
      return res.status(400).json({ error: 'Cuerpo del webhook inválido.' });
    }

    const hash_pedido = raiz.hash_pedido != null ? String(raiz.hash_pedido) : null;
    const token = raiz.token || (raiz.forma_pago && typeof raiz.forma_pago === 'object' ? raiz.forma_pago.token : null);
    const pagado = raiz.pagado === true || raiz.pagado === 'true';

    if (!hash_pedido) {
      return res.status(400).json({ error: 'Falta hash_pedido.' });
    }

    const pago = await PagoSuscripcion.findOne({ where: { hash_pedido } });
    if (!pago) {
      return res.status(404).json({ error: 'No hay una suscripción para ese pago.' });
    }

    const gateway = await SuscripcionService.gatewayDeSistema();
    if (!PagoParService.validateWebhookSignature(gateway.private_key, hash_pedido, token)) {
      console.warn(`[Webhook Suscripciones] Token inválido para ${hash_pedido}`);
      return res.status(400).json({ error: 'Token de seguridad inválido.' });
    }

    const montoRecibido = Math.round(parseFloat(raiz.monto));
    if (Number.isNaN(montoRecibido) || montoRecibido !== Math.round(pago.monto)) {
      console.warn(`[Webhook Suscripciones] Monto no coincide para ${hash_pedido}. Esperado: ${pago.monto}, recibido: ${raiz.monto}`);
    }

    // PagoPar espera de vuelta el mismo array `resultado` que mando, no un
    // mensaje propio (ver ecoPagopar en webhooks.controller.js).
    const eco = Array.isArray(body.resultado) ? body.resultado : [raiz];

    if (!pagado) {
      const tieneRechazoExplicito = raiz.cancelado === true || raiz.cancelado === 'true' || !!raiz.ultimo_mensaje_error;
      if (tieneRechazoExplicito) {
        await SuscripcionService.rechazarPago(pago, raiz);
      }
      return res.json(eco);
    }

    await SuscripcionService.acreditarPago(pago, raiz, { req, origen: 'PagoPar webhook' });
    return res.json(eco);
  } catch (error) {
    console.error('[Webhook Suscripciones] Error:', error);
    res.status(500).json({ error: 'Error interno al procesar el webhook.' });
  }
};

/** GET /api/suscripciones/token/:token — valida un token antes de mostrar el alta. */
exports.validarToken = async (req, res) => {
  try {
    const suscripcion = await SuscripcionService.suscripcionPorToken(req.params.token);
    if (!suscripcion) {
      return res.status(404).json({ error: 'Ese enlace no es válido, ya se usó o venció.' });
    }
    res.json({
      email: suscripcion.email,
      nombre: suscripcion.nombre,
      telefono: suscripcion.telefono,
      documento: suscripcion.documento,
      plan: suscripcion.Plan ? { codigo: suscripcion.Plan.codigo, nombre: suscripcion.Plan.nombre } : null,
    });
  } catch (error) {
    console.error('[Suscripciones] Error al validar token:', error);
    res.status(500).json({ error: 'No se pudo validar el enlace.' });
  }
};

/** GET /api/config/parametros — qué hay cargado (los secretos, solo si están). */
exports.listarParametros = async (req, res) => {
  try {
    res.json(await parametros.listarParaPanel());
  } catch (error) {
    console.error('[Parametros] Error al listar:', error);
    res.status(500).json({ error: 'No se pudieron cargar los parámetros.' });
  }
};

/**
 * PUT /api/configa — guarda uno o varios.
 * body: { PAGOPAR_PUBLIC_KEY: '...', PAGOPAR_PRIVATE_KEY: '...' }
 * Un secreto vacío significa "dejalo como está", para poder editar el
 * público sin tener que volver a pegar el privado.
 */
exports.guardarParametros = async (req, res) => {
  try {
    const permitidas = new Set(parametros.DEFINICIONES.map(d => d.clave));
    const entradas = Object.entries(req.body || {}).filter(([k]) => permitidas.has(k));

    if (!entradas.length) {
      return res.status(400).json({ error: 'No se envió ningún parámetro conocido.' });
    }
    for (const [clave, valor] of entradas) {
      await parametros.guardar(clave, valor);
    }
    res.json({ message: 'Parámetros guardados.', actualizados: entradas.map(([k]) => k) });
  } catch (error) {
    console.error('[Parametros] Error al guardar:', error);
    res.status(500).json({ error: 'No se pudieron guardar los parámetros.' });
  }
};

/** GET /api/config/payment-gateways/afiliados — reglas del programa. */
exports.obtenerAfiliadosConfig = async (req, res) => {
  try {
    const valores = await parametros.obtenerVarios([
      'AFILIADOS_PROGRAMA_ACTIVO',
      'AFILIADOS_COMISION_PCT',
      'AFILIADOS_REGLAS_JSON',
    ]);

    let reglas = {};
    if (valores.AFILIADOS_REGLAS_JSON) {
      try {
        reglas = JSON.parse(valores.AFILIADOS_REGLAS_JSON);
      } catch {
        reglas = {};
      }
    }

    res.json(normalizarAfiliadosConfig({
      ...reglas,
      activo: valores.AFILIADOS_PROGRAMA_ACTIVO == null
        ? AFILIADOS_DEFAULT.activo
        : valores.AFILIADOS_PROGRAMA_ACTIVO === 'true',
      comision_pct: valores.AFILIADOS_COMISION_PCT ?? AFILIADOS_DEFAULT.comision_pct,
    }));
  } catch (error) {
    console.error('[Afiliados] Error al obtener configuración:', error);
    res.status(500).json({ message: 'No se pudo cargar el programa de afiliados.' });
  }
};

/** PUT /api/config/payment-gateways/afiliados — guarda reglas del programa. */
exports.guardarAfiliadosConfig = async (req, res) => {
  try {
    const config = normalizarAfiliadosConfig(req.body || {});
    const reglas = {
      recurrencia: config.recurrencia,
      base_comisionable: config.base_comisionable,
      exclusiones: config.exclusiones,
      condiciones: config.condiciones,
    };

    await parametros.guardar('AFILIADOS_PROGRAMA_ACTIVO', config.activo ? 'true' : 'false', {
      grupo: 'afiliados',
      descripcion: 'Activa o pausa el Programa de Afiliados Gesicom.',
      secreto: false,
    });
    await parametros.guardar('AFILIADOS_COMISION_PCT', String(config.comision_pct), {
      grupo: 'afiliados',
      descripcion: 'Porcentaje recurrente sobre suscripciones SaaS elegibles cobradas.',
      secreto: false,
    });
    await parametros.guardar('AFILIADOS_REGLAS_JSON', JSON.stringify(reglas), {
      grupo: 'afiliados',
      descripcion: 'Reglas comerciales visibles del Programa de Afiliados.',
      secreto: false,
    });

    res.json(config);
  } catch (error) {
    console.error('[Afiliados] Error al guardar configuración:', error);
    res.status(500).json({ message: 'No se pudo guardar el programa de afiliados.' });
  }
};

module.exports = exports;
