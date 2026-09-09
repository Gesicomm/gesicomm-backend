const { PagoSuscripcion } = require('../models');
const SuscripcionService = require('../services/suscripcion.service');
const PagoParService = require('../services/payments/pagoParService');
const parametros = require('../services/parametros.service');

/** GET /api/planes — catálogo público. */
exports.listarPlanes = async (req, res) => {
  try {
    res.json(await SuscripcionService.listarPlanesPagos());
  } catch (error) {
    console.error('[Suscripciones] Error al listar planes:', error);
    res.status(500).json({ error: 'No se pudieron cargar los planes.' });
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

/** POST /api/suscripciones/pagopar-dummy — simula un pago acreditado en PagoPar. */
exports.pagoDummyPagopar = async (req, res) => {
  try {
    const { plan_codigo } = req.body || {};
    const resultado = await SuscripcionService.simularPagoPagopar(req.usuario.id, plan_codigo);
    return res.status(resultado.ya_estaba_activa ? 200 : 201).json({
      message: resultado.ya_estaba_activa
        ? 'Tu plan ya estaba activo.'
        : 'PagoPar dummy acreditó tu plan correctamente.',
      ...resultado,
    });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('[Suscripciones] Error en PagoPar dummy:', error);
    return res.status(status).json({ message: error.message || 'No se pudo simular el pago.' });
  }
};

/** POST /api/suscripciones/checkout — arranca el pago de un plan. */
exports.iniciarCheckout = async (req, res) => {
  try {
    const { plan_codigo, email, nombre } = req.body || {};
    const resultado = await SuscripcionService.iniciarCheckout({ plan_codigo, email, nombre });
    res.json(resultado);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('[Suscripciones] Error en checkout:', error);
    res.status(status).json({ error: error.message || 'No se pudo iniciar el pago.' });
  }
};

/** GET /api/suscripciones/estado/:hash — para la pantalla de resultado. */
exports.estadoPago = async (req, res) => {
  try {
    const estado = await SuscripcionService.estadoPorHash(req.params.hash);
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

    if (!pagado) {
      return res.json({ message: 'Webhook procesado correctamente.' });
    }

    const { yaEstaba } = await SuscripcionService.acreditarPago(pago, raiz);
    return res.json({
      message: yaEstaba
        ? 'La suscripción ya estaba acreditada.'
        : 'Webhook procesado correctamente.',
    });
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
 * PUT /api/config/parametros — guarda uno o varios.
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

module.exports = exports;
