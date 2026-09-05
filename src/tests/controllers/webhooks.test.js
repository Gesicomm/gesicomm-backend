const crypto = require('crypto');
const { pagoparWebhook } = require('../../controllers/webhooks.controller');
const { Envio, PaymentGateway, PaymentTransaction, sequelize } = require('../../models');
const PagoParService = require('../../services/payments/pagoParService');
const { descontarStockYSnapshot } = require('../../controllers/envioController');
const { registrarHistorial } = require('../../utils/historial');

jest.mock('../../models', () => ({
  Envio: { findByPk: jest.fn() },
  EnvioItem: {},
  PaymentGateway: { findOne: jest.fn() },
  PaymentTransaction: { findOne: jest.fn(), create: jest.fn() },
  // La transacción real no se toca en los tests: se ejecuta el callback
  // directo con un objeto de transacción de mentira.
  sequelize: { transaction: jest.fn(fn => fn('TRX')) },
}));
jest.mock('../../services/payments/pagoParService');
jest.mock('../../controllers/envioController', () => ({ descontarStockYSnapshot: jest.fn() }));
jest.mock('../../utils/historial');

const PRIVATE_KEY = 'secret';
const HASH = 'hash123';
const tokenValido = crypto.createHash('sha1').update(`${PRIVATE_KEY}${HASH}`).digest('hex');

// Formato documentado por PagoPar: objeto plano, token en la raíz.
function bodyPlano(extra = {}) {
  return {
    pagado: true,
    numero_pedido: 'GES-123',
    hash_pedido: HASH,
    monto: '50000.00',
    forma_pago: 'Tarjetas de crédito/débito',
    fecha_pago: '2023-06-07 09:11:49.52895',
    numero_comprobante_interno: '8230473',
    token: tokenValido,
    ...extra,
  };
}

function nuevoEnvio(extra = {}) {
  return {
    id: 123, usuario_id: 1, monto: 50000, costo_envio: 0,
    estado: 'Pendiente', stock_descontado: false, items: [{ id: 9 }],
    save: jest.fn(), ...extra,
  };
}

describe('Webhook Controller - pagoparWebhook', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { body: bodyPlano() };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    sequelize.transaction.mockImplementation(fn => fn('TRX'));
    PagoParService.validateWebhookSignature.mockReturnValue(true);
  });

  it('rechaza con 400 (no 500) un body vacío o sin los campos mínimos', async () => {
    req.body = {};
    await pagoparWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Cuerpo del webhook inválido o incompleto.' });
  });

  it('retorna 404 si el pedido no existe', async () => {
    Envio.findByPk.mockResolvedValue(null);
    PaymentTransaction.findOne.mockResolvedValue(null);
    await pagoparWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('resuelve el pedido por hash_pedido cuando numero_pedido no trae el prefijo GES-', async () => {
    req.body = bodyPlano({ numero_pedido: '1746' });
    const envio = nuevoEnvio();
    PaymentTransaction.findOne
      .mockResolvedValueOnce({ envio_id: 123 })              // búsqueda por hash
      .mockResolvedValueOnce({ status: 'PENDING', save: jest.fn() });
    Envio.findByPk.mockResolvedValue(envio);
    PaymentGateway.findOne.mockResolvedValue({ private_key: PRIVATE_KEY });

    await pagoparWebhook(req, res);

    expect(PaymentTransaction.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider: 'pagopar', payment_hash: HASH } })
    );
    expect(res.json).toHaveBeenCalledWith({ message: 'Webhook procesado correctamente.' });
  });

  it('valida la firma con sha1(private_key + hash_pedido)', async () => {
    Envio.findByPk.mockResolvedValue(nuevoEnvio());
    PaymentGateway.findOne.mockResolvedValue({ private_key: PRIVATE_KEY });
    PaymentTransaction.findOne.mockResolvedValue({ status: 'PENDING', save: jest.fn() });

    await pagoparWebhook(req, res);

    expect(PagoParService.validateWebhookSignature).toHaveBeenCalledWith(PRIVATE_KEY, HASH, tokenValido);
  });

  it('rechaza si la firma no coincide', async () => {
    Envio.findByPk.mockResolvedValue(nuevoEnvio());
    PaymentGateway.findOne.mockResolvedValue({ private_key: PRIVATE_KEY });
    PagoParService.validateWebhookSignature.mockReturnValue(false);

    await pagoparWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token de seguridad inválido.' });
  });

  it('confirma el pedido Y descuenta stock de verdad', async () => {
    const envio = nuevoEnvio();
    const trx = { status: 'PENDING', save: jest.fn() };
    Envio.findByPk.mockResolvedValue(envio);
    PaymentGateway.findOne.mockResolvedValue({ private_key: PRIVATE_KEY });
    PaymentTransaction.findOne.mockResolvedValue(trx);

    await pagoparWebhook(req, res);

    expect(trx.status).toBe('PAID');
    expect(descontarStockYSnapshot).toHaveBeenCalledWith(envio.items, 'TRX', envio.usuario_id);
    expect(envio.stock_descontado).toBe(true);
    expect(envio.estado).toBe('Confirmado');
    expect(envio.save).toHaveBeenCalled();
    expect(registrarHistorial).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'Webhook procesado correctamente.' });
  });

  it('no vuelve a descontar stock si el pedido ya lo tenía descontado', async () => {
    const envio = nuevoEnvio({ stock_descontado: true });
    Envio.findByPk.mockResolvedValue(envio);
    PaymentGateway.findOne.mockResolvedValue({ private_key: PRIVATE_KEY });
    PaymentTransaction.findOne.mockResolvedValue({ status: 'PENDING', save: jest.fn() });

    await pagoparWebhook(req, res);

    expect(descontarStockYSnapshot).not.toHaveBeenCalled();
    expect(envio.estado).toBe('Confirmado');
  });

  it('con pagado:false no confirma ni descuenta', async () => {
    req.body = bodyPlano({ pagado: false });
    const envio = nuevoEnvio();
    Envio.findByPk.mockResolvedValue(envio);
    PaymentGateway.findOne.mockResolvedValue({ private_key: PRIVATE_KEY });
    PaymentTransaction.findOne.mockResolvedValue({ status: 'PENDING', save: jest.fn() });

    await pagoparWebhook(req, res);

    expect(descontarStockYSnapshot).not.toHaveBeenCalled();
    expect(envio.estado).toBe('Pendiente');
    expect(res.json).toHaveBeenCalledWith({ message: 'Webhook procesado correctamente.' });
  });

  it('es idempotente si la transacción ya está pagada', async () => {
    Envio.findByPk.mockResolvedValue(nuevoEnvio({ estado: 'Confirmado' }));
    PaymentGateway.findOne.mockResolvedValue({ private_key: PRIVATE_KEY });
    const trx = { status: 'PAID', save: jest.fn() };
    PaymentTransaction.findOne.mockResolvedValue(trx);

    await pagoparWebhook(req, res);

    expect(trx.save).not.toHaveBeenCalled();
    expect(descontarStockYSnapshot).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'El pedido ya fue procesado y pagado anteriormente.' });
  });

  it('sigue aceptando el envoltorio resultado[] si PagoPar lo mandara', async () => {
    req.body = { resultado: [bodyPlano()] };
    Envio.findByPk.mockResolvedValue(nuevoEnvio());
    PaymentGateway.findOne.mockResolvedValue({ private_key: PRIVATE_KEY });
    PaymentTransaction.findOne.mockResolvedValue({ status: 'PENDING', save: jest.fn() });

    await pagoparWebhook(req, res);

    expect(res.json).toHaveBeenCalledWith({ message: 'Webhook procesado correctamente.' });
  });
});

describe('PagoParService.validateWebhookSignature (implementación real)', () => {
  const real = jest.requireActual('../../services/payments/pagoParService');

  it('acepta sha1(private_key + hash_pedido)', () => {
    expect(real.validateWebhookSignature(PRIVATE_KEY, HASH, tokenValido)).toBe(true);
  });

  it('rechaza la fórmula vieja sha1(private_key + "PAGOPAR")', () => {
    const viejo = crypto.createHash('sha1').update(`${PRIVATE_KEY}PAGOPAR`).digest('hex');
    expect(real.validateWebhookSignature(PRIVATE_KEY, HASH, viejo)).toBe(false);
  });

  it('rechaza token vacío o de largo distinto sin explotar', () => {
    expect(real.validateWebhookSignature(PRIVATE_KEY, HASH, null)).toBe(false);
    expect(real.validateWebhookSignature(PRIVATE_KEY, HASH, 'corto')).toBe(false);
    expect(real.validateWebhookSignature(PRIVATE_KEY, null, tokenValido)).toBe(false);
  });
});
