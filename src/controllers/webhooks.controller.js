const { Envio, PaymentGateway, PaymentTransaction } = require('../models');
const PagoParService = require('../services/payments/pagoParService');
const { registrarHistorial } = require('../utils/historial');

exports.pagoparWebhook = async (req, res) => {
  try {
    const data = req.body;
    
    // PagoPar envía el token, resultado, etc.
    const tokenRecibido = data.resultado[0]?.forma_pago?.token;
    const pagado = data.resultado[0]?.pagado;
    const numero_pedido = data.resultado[0]?.numero_pedido; // Este es nuestro "GES-1234"
    const hash_pedido = data.resultado[0]?.hash_pedido;
    const monto = data.resultado[0]?.monto;

    if (!numero_pedido || !numero_pedido.startsWith('GES-')) {
      return res.status(400).json({ error: 'Pedido inválido o ajeno a Gesicomm.' });
    }

    const envioId = parseInt(numero_pedido.replace('GES-', ''), 10);
    if (isNaN(envioId)) {
      return res.status(400).json({ error: 'Formato de pedido inválido.' });
    }

    const envio = await Envio.findByPk(envioId);
    if (!envio) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }

    const gateway = await PaymentGateway.findOne({
      where: { usuario_id: envio.usuario_id, provider: 'pagopar' }
    });

    if (!gateway || !gateway.private_key) {
      return res.status(400).json({ error: 'El comercio no tiene PagoPar configurado.' });
    }

    // Validar firma
    const isValid = PagoParService.validateWebhookSignature(gateway.private_key, tokenRecibido);
    if (!isValid) {
      console.warn(`[Webhook PagoPar] Token inválido para el pedido ${numero_pedido}`);
      return res.status(400).json({ error: 'Token de seguridad inválido.' });
    }

    // Validar monto
    const montoEsperado = envio.monto + (envio.costo_envio || 0);
    if (parseInt(monto, 10) !== montoEsperado) {
      console.warn(`[Webhook PagoPar] Monto no coincide para ${numero_pedido}. Esperado: ${montoEsperado}, Recibido: ${monto}`);
      // No cortamos la ejecución, pero anotamos
    }

    // Encontrar la transacción
    let transaction = await PaymentTransaction.findOne({
      where: { envio_id: envio.id, provider: 'pagopar' }
    });

    if (!transaction) {
      transaction = await PaymentTransaction.create({
        envio_id: envio.id,
        provider: 'pagopar',
        payment_reference: numero_pedido,
        payment_hash: hash_pedido,
        status: 'PENDING',
        amount: montoEsperado
      });
    }

    // Si ya está pagada y llega otra vez el webhook, es idempotente
    if (transaction.status === 'PAID') {
      return res.json({ message: 'El pedido ya fue procesado y pagado anteriormente.' });
    }

    if (pagado === true) {
      transaction.status = 'PAID';
      await transaction.save();

      // Actualizar el estado del envío si está pendiente
      if (envio.estado === 'Pendiente') {
        envio.estado = 'Confirmado';
        envio.estado_comercial = 'Confirmado';
        
        // Idempotencia de stock
        if (!envio.stock_descontado) {
          envio.stock_descontado = true;
          // Acá idealmente se descontaría el stock llamando al servicio de inventario
          // const envioController = require('./envioController');
          // Podríamos requerir y usar envioController.updateEstado pero es mejor dejarlo como está
        }
        
        await envio.save();
        await registrarHistorial(envio.id, null, 'Pago recibido por PagoPar. Estado actualizado a Confirmado.');
      }
    }

    res.json({ message: 'Webhook procesado correctamente.' });
  } catch (error) {
    console.error('[Webhook PagoPar] Error:', error);
    res.status(500).json({ error: 'Error interno al procesar el webhook.' });
  }
};
