const crypto = require('crypto');
const axios = require('axios');
const { Envio, EnvioItem, PaymentGateway, PaymentTransaction } = require('../models');
const PagoParService = require('../services/payments/pagoParService');
const { confirmarPedidoPagado } = require('../services/payments/confirmacionPago');

/**
 * Saca el motivo legible de una respuesta de rechazo de PagoPar.
 *
 * `resultado` no tiene una forma estable: a veces es un array de objetos
 * ([{ datos: "..." }]) y a veces un string suelto — por ejemplo
 * "Comercio de desarrollo no habilitado o con acceso vencido.". Antes solo
 * se contemplaba el array, así que el motivo más útil quedaba en el log del
 * servidor y al comercio le llegaba un mensaje genérico.
 */
function detallePagopar(data) {
  const r = data?.resultado;
  if (typeof r === 'string' && r.trim()) return r.trim();
  if (Array.isArray(r) && r.length) {
    const primero = r[0];
    if (typeof primero === 'string') return primero;
    return primero?.datos || primero?.mensaje || null;
  }
  return null;
}

exports.getPagoparConfig = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const gateway = await PaymentGateway.findOne({
      where: { usuario_id, provider: 'pagopar' }
    });

    if (!gateway) {
      return res.json({
        provider: 'pagopar',
        is_active: false,
        has_private_key: false,
        environment: 'sandbox',
        public_key: ''
      });
    }

    res.json({
      provider: 'pagopar',
      is_active: gateway.is_active,
      environment: gateway.environment,
      public_key: gateway.public_key,
      has_private_key: !!gateway.private_key
    });
  } catch (error) {
    console.error('[PaymentGateways] Error al obtener configuración:', error);
    res.status(500).json({ error: 'Error al obtener la configuración de la pasarela.' });
  }
};

exports.updatePagoparConfig = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { public_key, private_key, environment, is_active } = req.body;

    let gateway = await PaymentGateway.findOne({
      where: { usuario_id, provider: 'pagopar' }
    });

    if (!gateway) {
      gateway = await PaymentGateway.create({
        usuario_id,
        provider: 'pagopar',
        public_key,
        private_key, // Se cifra en el setter del modelo
        environment: environment || 'sandbox',
        is_active: is_active !== undefined ? is_active : true
      });
    } else {
      gateway.public_key = public_key !== undefined ? public_key : gateway.public_key;
      // Solo actualizamos private_key si se envió un valor real
      if (private_key && private_key.trim() !== '') {
        gateway.private_key = private_key;
      }
      gateway.environment = environment !== undefined ? environment : gateway.environment;
      gateway.is_active = is_active !== undefined ? is_active : gateway.is_active;
      await gateway.save();
    }

    res.json({ message: 'Configuración guardada exitosamente.' });
  } catch (error) {
    console.error('[PaymentGateways] Error al actualizar configuración:', error);
    res.status(500).json({ error: 'Error al guardar la configuración.' });
  }
};

exports.testPagoparConnection = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const gateway = await PaymentGateway.findOne({
      where: { usuario_id, provider: 'pagopar' }
    });

    if (!gateway || !gateway.private_key || !gateway.public_key) {
      return res.status(400).json({ error: 'Faltan credenciales para probar la conexión.' });
    }

    // Ping sin crear un pedido: el endpoint de formas de pago.
    //
    //   POST https://api.pagopar.com/api/forma-pago/1.1/traer/
    //   token = sha1(private_key + "FORMA-PAGO")
    //   body  = { token, token_publico }
    //
    // Tres detalles que antes estaban mal y hacían fallar la prueba aunque
    // las credenciales fueran correctas:
    //   1. el token se armaba con "TRAER-MEDIOS-PAGO" (cadena inexistente),
    //   2. se pegaba a /api/medio-pago/1.1/traer (endpoint inexistente),
    //   3. el token público se mandaba como `public_key`, que es el nombre
    //      del endpoint 2.0 (iniciar-transaccion). Los endpoints 1.1 lo
    //      esperan como `token_publico`.
    const token = crypto.createHash('sha1').update(`${gateway.private_key}FORMA-PAGO`).digest('hex');

    const response = await axios.post('https://api.pagopar.com/api/forma-pago/1.1/traer/', {
      token,
      token_publico: gateway.public_key,
    });

    if (response.data && response.data.respuesta === true) {
      return res.json({ success: true, message: 'Conexión exitosa' });
    }

    // Devolver lo que contestó PagoPar en vez de un mensaje genérico: sin
    // esto, diagnosticar una credencial mal cargada es adivinar.
    const detalle = detallePagopar(response.data);
    console.warn('[PaymentGateways] PagoPar rechazó el ping:', JSON.stringify(response.data));
    return res.status(400).json({
      success: false,
      error: detalle
        ? `PagoPar rechazó la conexión: ${detalle}`
        : 'PagoPar rechazó la conexión. Revisá que el token público y el privado sean del mismo comercio.',
    });
  } catch (error) {
    const detalle = error.response?.data;
    console.error('[PaymentGateways] Error en prueba de conexión:', detalle || error.message);
    res.status(400).json({
      success: false,
      error: error.response
        ? `PagoPar respondió ${error.response.status}. Si estás en producción, verificá que la IP del servidor esté habilitada en el panel de PagoPar.`
        : 'No se pudo contactar a PagoPar (problema de red o DNS).',
    });
  }
};

/**
 * Paso #3 del flujo de PagoPar: consultar el estado de un pedido.
 *
 * POST /api/config/payment-gateways/pagopar/consultar
 * body: { envio_id } o { hash_pedido }
 *
 * Además de responder qué dice PagoPar, RECONCILIA: si el pedido figura
 * pagado allá y acá seguía pendiente (típicamente porque se perdió el
 * callback), lo confirma con la misma función que usa el webhook — no con
 * una copia de la lógica.
 */
exports.consultarPedidoPagopar = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { envio_id, hash_pedido } = req.body || {};

    if (!envio_id && !hash_pedido) {
      return res.status(400).json({ error: 'Indicá envio_id o hash_pedido.' });
    }

    const gateway = await PaymentGateway.findOne({ where: { usuario_id, provider: 'pagopar' } });
    if (!gateway || !gateway.private_key || !gateway.public_key) {
      return res.status(400).json({ error: 'Faltan credenciales de PagoPar.' });
    }

    // La transacción es la que guarda el hash de PagoPar (ver
    // PaymentService.createTransaction), así que se busca por ahí.
    const where = { provider: 'pagopar' };
    if (envio_id) where.envio_id = envio_id;
    else where.payment_hash = hash_pedido;

    const transaction = await PaymentTransaction.findOne({ where });
    if (!transaction) {
      return res.status(404).json({ error: 'No hay una transacción de PagoPar para ese pedido.' });
    }

    const envio = await Envio.findByPk(transaction.envio_id, {
      include: [{ model: EnvioItem, as: 'items' }],
    });
    if (!envio) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }
    // El pedido tiene que ser del comercio que pregunta.
    if (envio.usuario_id !== usuario_id) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }

    const consulta = await PagoParService.consultarEstadoPedido(
      gateway,
      hash_pedido || transaction.payment_hash,
    );

    let reconciliacion = 'sin_cambios';
    if (consulta.pagado) {
      reconciliacion = await confirmarPedidoPagado(envio, transaction, { origen: 'PagoPar (consulta)' });
    }

    return res.json({
      success: true,
      pagado: consulta.pagado,
      estado_pedido: envio.estado,
      estado_transaccion: transaction.status,
      reconciliacion,
      pagopar: consulta.datos,
    });
  } catch (error) {
    console.error('[PaymentGateways] Error al consultar pedido:', error.response?.data || error.message);
    return res.status(400).json({
      success: false,
      error: error.response
        ? `PagoPar respondió ${error.response.status} al consultar el pedido.`
        : error.message || 'No se pudo consultar el pedido en PagoPar.',
    });
  }
};
