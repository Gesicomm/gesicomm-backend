const { PaymentGateway } = require('../models');
const PagoParService = require('../services/payments/pagoParService');

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

    // Para probar la conexión en PagoPar sin crear un pedido real, podemos generar un token
    // y tratar de obtener los medios de pago, o simplemente reportar éxito si las credenciales están presentes
    // Ya que la API de traer medios de pago sirve como ping: https://api.pagopar.com/api/medio-pago/1.1/traer
    // Token = sha1(private_key + "TRAER-MEDIOS-PAGO")
    const crypto = require('crypto');
    const token = crypto.createHash('sha1').update(`${gateway.private_key}TRAER-MEDIOS-PAGO`).digest('hex');

    const axios = require('axios');
    const response = await axios.post('https://api.pagopar.com/api/medio-pago/1.1/traer', {
      token: token,
      public_key: gateway.public_key
    });

    if (response.data && response.data.respuesta === true) {
      return res.json({ success: true, message: 'Conexión exitosa' });
    } else {
      return res.status(400).json({ success: false, error: 'No se pudo conectar. Verificá tus credenciales y el entorno.' });
    }
  } catch (error) {
    console.error('[PaymentGateways] Error en prueba de conexión:', error.message);
    res.status(400).json({ success: false, error: 'No se pudo conectar con PagoPar.' });
  }
};
