const { pagoparWebhook } = require('../../controllers/webhooks.controller');
const { Envio, PaymentGateway, PaymentTransaction } = require('../../models');
const PagoParService = require('../../services/payments/pagoParService');
const { registrarHistorial } = require('../../utils/historial');

jest.mock('../../models', () => ({
  Envio: { findByPk: jest.fn() },
  PaymentGateway: { findOne: jest.fn() },
  PaymentTransaction: { findOne: jest.fn(), create: jest.fn() }
}));
jest.mock('../../services/payments/pagoParService');
jest.mock('../../utils/historial');

describe('Webhook Controller - pagoparWebhook', () => {
  let req, res;

  beforeEach(() => {
    req = {
      body: {
        resultado: [{
          pagado: true,
          numero_pedido: 'GES-123',
          hash_pedido: 'hash123',
          monto: '50000',
          forma_pago: { token: 'valid_token' }
        }]
      }
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    jest.clearAllMocks();
  });

  it('debe rechazar si el numero_pedido no es valido', async () => {
    req.body.resultado[0].numero_pedido = 'INVALID-123';
    await pagoparWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Pedido inválido o ajeno a Gesicomm.' });
  });

  it('debe retornar 404 si el pedido no existe en db', async () => {
    Envio.findByPk = jest.fn().mockResolvedValue(null);
    await pagoparWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('debe validar la firma y actualizar el pedido si esta pendiente', async () => {
    const envioMock = { id: 123, usuario_id: 1, monto: 50000, costo_envio: 0, estado: 'Pendiente', stock_descontado: false, save: jest.fn() };
    const gatewayMock = { private_key: 'secret' };
    const transactionMock = { status: 'PENDING', save: jest.fn() };

    Envio.findByPk = jest.fn().mockResolvedValue(envioMock);
    PaymentGateway.findOne = jest.fn().mockResolvedValue(gatewayMock);
    PagoParService.validateWebhookSignature.mockReturnValue(true);
    PaymentTransaction.findOne = jest.fn().mockResolvedValue(transactionMock);

    await pagoparWebhook(req, res);

    expect(transactionMock.status).toBe('PAID');
    expect(transactionMock.save).toHaveBeenCalled();
    expect(envioMock.estado).toBe('Confirmado');
    expect(envioMock.stock_descontado).toBe(true);
    expect(envioMock.save).toHaveBeenCalled();
    expect(registrarHistorial).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'Webhook procesado correctamente.' });
  });

  it('debe manejar idempotencia si la transaccion ya esta pagada', async () => {
    const envioMock = { id: 123, usuario_id: 1, monto: 50000, costo_envio: 0, estado: 'Confirmado' };
    const gatewayMock = { private_key: 'secret' };
    const transactionMock = { status: 'PAID', save: jest.fn() };

    Envio.findByPk = jest.fn().mockResolvedValue(envioMock);
    PaymentGateway.findOne = jest.fn().mockResolvedValue(gatewayMock);
    PagoParService.validateWebhookSignature.mockReturnValue(true);
    PaymentTransaction.findOne = jest.fn().mockResolvedValue(transactionMock);

    await pagoparWebhook(req, res);

    expect(transactionMock.save).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'El pedido ya fue procesado y pagado anteriormente.' });
  });
});
