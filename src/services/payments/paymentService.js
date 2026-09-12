const PagoParService = require('./pagoParService');
const { PaymentGateway, PaymentTransaction } = require('../../models');

class PaymentService {
  /**
   * Procesa la creación de un pedido con una pasarela de pago externa.
   * @param {Object} envio - El pedido creado (modelo Envio)
   * @param {string} provider - El proveedor ('pagopar', etc)
   * @param {string} returnUrl - URL a donde redirigir al finalizar
   * @returns {Object} { success, payment_url, hash_pedido }
   */
  static async createTransaction(envio, provider, returnUrl) {
    if (provider !== 'pagopar') {
      throw new Error('Proveedor de pago no soportado actualmente.');
    }

    // Buscar credenciales activas del usuario dueño del pedido
    const gateway = await PaymentGateway.findOne({
      where: {
        usuario_id: envio.usuario_id,
        provider: provider,
        is_active: true
      }
    });

    if (!gateway) {
      throw new Error('El comercio no tiene configurada una pasarela de pago activa.');
    }

    if (!gateway.private_key || !gateway.public_key) {
      throw new Error('La pasarela de pago del comercio no está configurada correctamente.');
    }

    let transactionResult;

    if (provider === 'pagopar') {
      transactionResult = await PagoParService.createTransaction(gateway, envio, returnUrl);
    }

    if (transactionResult && transactionResult.success) {
      // Registrar la transacción de pago
      await PaymentTransaction.create({
        envio_id: envio.id,
        provider: provider,
        payment_reference: String(envio.id),
        payment_hash: transactionResult.hash_pedido,
        status: 'PENDING',
        amount: envio.monto
      });
    }

    return transactionResult;
  }
  
  static async getPublicGateways(usuario_id) {
    const gateways = await PaymentGateway.findAll({
      where: {
        usuario_id: usuario_id,
        is_active: true
      },
      attributes: ['provider', 'public_key', 'environment']
    });
    
    // We only expose minimal info publicly (provider name, environment)
    return gateways.map(g => ({
      provider: g.provider,
      environment: g.environment
    }));
  }
}

module.exports = PaymentService;
