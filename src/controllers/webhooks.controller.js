const { Envio, EnvioItem, PaymentGateway, PaymentTransaction, sequelize } = require('../models');
const PagoParService = require('../services/payments/pagoParService');
const { descontarStockYSnapshot } = require('./envioController');
const { registrarHistorial } = require('../utils/historial');

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
 * PagoPar puede devolver `numero_pedido` como nuestro `id_pedido_comercio`
 * ("GES-123") o como su propio correlativo interno ("1746"). Por eso se
 * intenta primero por el prefijo y, si no aplica, se resuelve por
 * `hash_pedido` contra la PaymentTransaction que se guardó al iniciar la
 * transacción (ver PaymentService.createTransaction).
 */
async function ubicarEnvio({ numero_pedido, hash_pedido }) {
  if (numero_pedido && numero_pedido.startsWith('GES-')) {
    const envioId = parseInt(numero_pedido.slice(4), 10);
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
    const montoEsperado = Number(envio.monto) + Number(envio.costo_envio || 0);
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
        payment_reference: datos.numero_pedido || `GES-${envio.id}`,
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

    // Confirmación + descuento de stock en una sola transacción: si el stock
    // falla, el pedido no queda marcado como pagado y PagoPar reintenta.
    //
    // Antes acá se ponía `stock_descontado = true` con un comentario que
    // decía "acá idealmente se descontaría el stock" — sin descontarlo. Eso
    // no solo salteaba el movimiento: dejaba el flag en true, con lo cual el
    // descuento real de envioController (`if (estado === 'Confirmado' &&
    // !envio.stock_descontado)`) ya no se ejecutaba nunca para ese pedido.
    await sequelize.transaction(async (t) => {
      transaction.status = 'PAID';
      await transaction.save({ transaction: t });

      if (envio.estado !== 'Pendiente') return;

      if (!envio.stock_descontado) {
        await descontarStockYSnapshot(envio.items || [], t, envio.usuario_id);
        envio.stock_descontado = true;
      }

      envio.estado = 'Confirmado';
      envio.estado_comercial = 'Confirmado';
      envio.estado_logistico = 'Confirmado';
      await envio.save({ transaction: t });

      await registrarHistorial(envio.id, null, 'Pago recibido por PagoPar. Estado actualizado a Confirmado.', t);
    });

    res.json({ message: 'Webhook procesado correctamente.' });
  } catch (error) {
    console.error('[Webhook PagoPar] Error:', error);
    res.status(500).json({ error: 'Error interno al procesar el webhook.' });
  }
};
