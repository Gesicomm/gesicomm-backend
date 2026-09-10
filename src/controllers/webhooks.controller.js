const { Envio, EnvioItem, PaymentGateway, PaymentTransaction } = require('../models');
const PagoParService = require('../services/payments/pagoParService');
const { confirmarPedidoPagado } = require('../services/payments/confirmacionPago');

/**
 * Normaliza el cuerpo del callback de PagoPar.
 *
 * La documentación describe un objeto PLANO:
 *
 *   { pagado, numero_pedido, monto, hash_pedido, forma_pago,
 *     fecha_pago, numero_comprobante_interno, token }
 *
 * donde `token` va en la raíz y `forma_pago` es un texto legible
 * ("Tarjetas de crédito/débito"), no un objeto. Antes acá se leía
 * `body.resultado[0].forma_pago.token`, que sobre ese payload da
 * `undefined` — y como `body.resultado` ni siquiera estaba protegido, un
 * callback real tiraba TypeError y devolvía 500 (con lo cual PagoPar
 * reintentaba contra un error que nunca se iba a resolver).
 *
 * Se acepta igual el envoltorio `resultado[0]` por si alguna versión de la
 * API lo manda así: la firma es la que decide, no la forma del sobre.
 */
function normalizarPayload(body) {
  if (!body || typeof body !== 'object') return null;
  const raiz = Array.isArray(body.resultado) ? body.resultado[0] : body;
  if (!raiz || typeof raiz !== 'object') return null;

  // `forma_pago` es string en el formato documentado; si viniera como objeto
  // con token adentro, se respeta como fallback.
  const tokenAnidado = raiz.forma_pago && typeof raiz.forma_pago === 'object'
    ? raiz.forma_pago.token
    : undefined;

  return {
    pagado: raiz.pagado === true || raiz.pagado === 'true',
    numero_pedido: raiz.numero_pedido != null ? String(raiz.numero_pedido) : null,
    hash_pedido: raiz.hash_pedido != null ? String(raiz.hash_pedido) : null,
    monto: raiz.monto,
    token: raiz.token || tokenAnidado || null,
  };
}

/**
 * Ubica el pedido del callback.
 *
 * `numero_pedido` es el `id_pedido_comercio` que mandamos nosotros: hoy es
 * el id del Envio pelado. Se sigue tolerando el prefijo "GES-" al LEER,
 * porque las transacciones iniciadas antes de sacarlo ya viajaron con él y
 * su callback puede llegar en cualquier momento — pero al emitir ya no se
 * usa (ver PagoParService.createTransaction).
 *
 * Si el número no resuelve (PagoPar podría mandar su propio correlativo
 * interno), se cae a buscar por `hash_pedido` contra la PaymentTransaction
 * guardada al iniciar la transacción.
 */
async function ubicarEnvio({ numero_pedido, hash_pedido }) {
  if (numero_pedido) {
    const envioId = parseInt(String(numero_pedido).replace(/^GES-/, ''), 10);
    if (!Number.isNaN(envioId)) {
      const envio = await Envio.findByPk(envioId, { include: [{ model: EnvioItem, as: 'items' }] });
      if (envio) return envio;
    }
  }

  if (hash_pedido) {
    const trx = await PaymentTransaction.findOne({
      where: { provider: 'pagopar', payment_hash: hash_pedido },
    });
    if (trx) {
      return Envio.findByPk(trx.envio_id, { include: [{ model: EnvioItem, as: 'items' }] });
    }
  }

  return null;
}

exports.pagoparWebhook = async (req, res) => {
  try {
    const datos = normalizarPayload(req.body);
    if (!datos || (!datos.numero_pedido && !datos.hash_pedido)) {
      return res.status(400).json({ error: 'Cuerpo del webhook inválido o incompleto.' });
    }

    const envio = await ubicarEnvio(datos);
    if (!envio) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }

    const gateway = await PaymentGateway.findOne({
      where: { usuario_id: envio.usuario_id, provider: 'pagopar' },
    });
    if (!gateway || !gateway.private_key) {
      return res.status(400).json({ error: 'El comercio no tiene PagoPar configurado.' });
    }

    // Firma: sha1(private_key + hash_pedido). Es lo único que autentica el
    // callback, así que se valida antes de tocar nada.
    if (!PagoParService.validateWebhookSignature(gateway.private_key, datos.hash_pedido, datos.token)) {
      console.warn(`[Webhook PagoPar] Token inválido para el pedido ${datos.numero_pedido || datos.hash_pedido}`);
      return res.status(400).json({ error: 'Token de seguridad inválido.' });
    }

    // El monto llega como string decimal ("100000.00").
    // Mismo criterio que pagoParService al generar el cobro: se espera el
    // `monto` pelado, sin el flete. Si acá se sumara costo_envio, todo pago
    // online quedaría marcado como "monto no coincide" en la conciliación.
    const montoEsperado = Number(envio.monto);
    const montoRecibido = Math.round(parseFloat(datos.monto));
    if (Number.isNaN(montoRecibido) || montoRecibido !== Math.round(montoEsperado)) {
      console.warn(`[Webhook PagoPar] Monto no coincide para ${datos.numero_pedido}. Esperado: ${montoEsperado}, Recibido: ${datos.monto}`);
      // No se corta: la firma ya prueba que el aviso viene de PagoPar. Se
      // deja anotado para conciliación manual.
    }

    let transaction = await PaymentTransaction.findOne({
      where: { envio_id: envio.id, provider: 'pagopar' },
    });

    if (!transaction) {
      transaction = await PaymentTransaction.create({
        envio_id: envio.id,
        provider: 'pagopar',
        payment_reference: datos.numero_pedido || String(envio.id),
        payment_hash: datos.hash_pedido,
        status: 'PENDING',
        amount: montoEsperado,
      });
    }

    // Idempotencia: PagoPar reintenta el callback hasta recibir un 2xx.
    if (transaction.status === 'PAID') {
      return res.json({ message: 'El pedido ya fue procesado y pagado anteriormente.' });
    }

    if (!datos.pagado) {
      return res.json({ message: 'Webhook procesado correctamente.' });
    }

    await confirmarPedidoPagado(envio, transaction, { origen: 'PagoPar' });

    res.json({ message: 'Webhook procesado correctamente.' });
  } catch (error) {
    console.error('[Webhook PagoPar] Error:', error);
    res.status(500).json({ error: 'Error interno al procesar el webhook.' });
  }
};
