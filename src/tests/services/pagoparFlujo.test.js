/**
 * Flujo completo de PagoPar, de punta a punta sobre nuestro lado de la
 * integración. Cada paso verifica la URL, la fórmula del token y los nombres
 * de campo EXACTOS que documenta PagoPar — que es justamente donde estaban
 * los bugs: fórmulas y endpoints inventados que nadie había contrastado
 * contra la documentación.
 */
const crypto = require('crypto');
const axios = require('axios');

jest.mock('axios');
jest.mock('../../controllers/envioController', () => ({ descontarStockYSnapshot: jest.fn() }));
jest.mock('../../utils/historial', () => ({ registrarHistorial: jest.fn() }));
jest.mock('../../models', () => ({
  Envio: { findByPk: jest.fn() },
  EnvioItem: {},
  PaymentGateway: { findOne: jest.fn() },
  PaymentTransaction: { findOne: jest.fn(), create: jest.fn() },
  sequelize: { transaction: jest.fn(fn => fn('TRX')) },
}));

const PagoParService = require('../../services/payments/pagoParService');
const { pagoparWebhook } = require('../../controllers/webhooks.controller');
const ctrl = require('../../controllers/paymentGateways.controller');
const { Envio, PaymentGateway, PaymentTransaction, sequelize } = require('../../models');
const { descontarStockYSnapshot } = require('../../controllers/envioController');

const PRIVATE = 'private_de_prueba';
const PUBLIC = 'public_de_prueba';
const HASH = 'ad57c9c94f745fdd9bc9093bb4092976';
// Lo que se le cobra al comprador es el `monto` del pedido y nada más: el
// delivery (costo_envio: 25.000 en el mock) NO se le suma — es costo del
// comercio, no del cliente, y el checkout público le muestra este mismo
// número. Antes acá se esperaba 175.000 (monto + flete), que era justo el
// importe de más que se le terminaba cobrando.
const MONTO = 150000;

const gateway = { private_key: PRIVATE, public_key: PUBLIC };
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

function envioMock(extra) {
  return Object.assign({
    id: 1234,
    usuario_id: 7,
    monto: 150000,
    costo_envio: 25000,
    estado: 'Pendiente',
    stock_descontado: false,
    items: [{ id: 1, cantidad: 2 }],
    cliente: 'Ana Torres',
    telefono: '595981000000',
    direccion: 'Asuncion',
    save: jest.fn(),
  }, extra || {});
}

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

beforeEach(() => {
  jest.clearAllMocks();
  sequelize.transaction.mockImplementation((fn) => fn('TRX'));
});

describe('Paso 1 — iniciar transaccion', () => {
  it('usa el endpoint 2.0, token sha1(private + idPedido + monto) y public_key', async () => {
    axios.post.mockResolvedValue({ data: { respuesta: true, resultado: [{ data: HASH }] } });

    const r = await PagoParService.createTransaction(gateway, envioMock(), 'https://api.gesicomm.com');

    const url = axios.post.mock.calls[0][0];
    const body = axios.post.mock.calls[0][1];
    expect(url).toBe('https://api.pagopar.com/api/comercios/2.0/iniciar-transaccion');
    expect(body.token).toBe(sha1(PRIVATE + '1234' + MONTO));
    expect(body.public_key).toBe(PUBLIC);        // el 2.0 usa public_key
    expect(body.token_publico).toBeUndefined();
    expect(body.id_pedido_comercio).toBe('1234');
    expect(body.monto_total).toBe(MONTO);
    expect(r.payment_url).toBe('https://www.pagopar.com/pagos/' + HASH);
  });
});

describe('Paso 2 — callback confirma el pedido y descuenta stock', () => {
  it('acepta el payload plano documentado', async () => {
    const envio = envioMock();
    const trx = { status: 'PENDING', save: jest.fn() };
    Envio.findByPk.mockResolvedValue(envio);
    PaymentGateway.findOne.mockResolvedValue(gateway);
    PaymentTransaction.findOne.mockResolvedValue(trx);

    const req = {
      body: {
        pagado: true,
        numero_pedido: '1234',
        hash_pedido: HASH,
        monto: '175000.00',
        forma_pago: 'Tarjetas de credito/debito',
        token: sha1(PRIVATE + HASH),
      },
    };
    const r = res();
    await pagoparWebhook(req, r);

    expect(trx.status).toBe('PAID');
    expect(descontarStockYSnapshot).toHaveBeenCalledWith(envio.items, 'TRX', envio.usuario_id);
    expect(envio.stock_descontado).toBe(true);
    expect(envio.estado).toBe('Confirmado');
    expect(r.json).toHaveBeenCalledWith({ message: 'Webhook procesado correctamente.' });
  });

  it('rechaza un callback firmado con la formula vieja', async () => {
    Envio.findByPk.mockResolvedValue(envioMock());
    PaymentGateway.findOne.mockResolvedValue(gateway);

    const req = {
      body: {
        pagado: true,
        numero_pedido: '1234',
        hash_pedido: HASH,
        monto: '175000.00',
        token: sha1(PRIVATE + 'PAGOPAR'),
      },
    };
    const r = res();
    await pagoparWebhook(req, r);

    expect(r.status).toHaveBeenCalledWith(400);
    expect(descontarStockYSnapshot).not.toHaveBeenCalled();
  });
});

describe('Paso 3 — consultar estado y reconciliar', () => {
  const reqBase = { usuario: { id: 7 }, body: { envio_id: 1234 } };

  it('usa /api/pedidos/1.1/traer con sha1(private + CONSULTA) y token_publico', async () => {
    PaymentGateway.findOne.mockResolvedValue(gateway);
    PaymentTransaction.findOne.mockResolvedValue({ status: 'PENDING', payment_hash: HASH, envio_id: 1234, save: jest.fn() });
    Envio.findByPk.mockResolvedValue(envioMock());
    axios.post.mockResolvedValue({ data: { respuesta: true, resultado: [{ pagado: true }] } });

    await ctrl.consultarPedidoPagopar(reqBase, res());

    const url = axios.post.mock.calls[0][0];
    const body = axios.post.mock.calls[0][1];
    expect(url).toBe('https://api.pagopar.com/api/pedidos/1.1/traer');
    expect(body.token).toBe(sha1(PRIVATE + 'CONSULTA'));
    expect(body.token_publico).toBe(PUBLIC);      // el 1.1 usa token_publico
    expect(body.public_key).toBeUndefined();
    expect(body.hash_pedido).toBe(HASH);
  });

  it('reconcilia un pedido pagado cuyo callback se perdio', async () => {
    const envio = envioMock();
    const trx = { status: 'PENDING', payment_hash: HASH, envio_id: 1234, save: jest.fn() };
    PaymentGateway.findOne.mockResolvedValue(gateway);
    PaymentTransaction.findOne.mockResolvedValue(trx);
    Envio.findByPk.mockResolvedValue(envio);
    axios.post.mockResolvedValue({ data: { respuesta: true, resultado: [{ pagado: true }] } });

    const r = res();
    await ctrl.consultarPedidoPagopar(reqBase, r);

    expect(trx.status).toBe('PAID');
    expect(envio.estado).toBe('Confirmado');
    expect(descontarStockYSnapshot).toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({
      pagado: true,
      reconciliacion: 'confirmado',
    }));
  });

  it('no toca nada si PagoPar dice que no esta pagado', async () => {
    const envio = envioMock();
    const trx = { status: 'PENDING', payment_hash: HASH, envio_id: 1234, save: jest.fn() };
    PaymentGateway.findOne.mockResolvedValue(gateway);
    PaymentTransaction.findOne.mockResolvedValue(trx);
    Envio.findByPk.mockResolvedValue(envio);
    axios.post.mockResolvedValue({ data: { respuesta: true, resultado: [{ pagado: false }] } });

    const r = res();
    await ctrl.consultarPedidoPagopar(reqBase, r);

    expect(trx.status).toBe('PENDING');
    expect(envio.estado).toBe('Pendiente');
    expect(descontarStockYSnapshot).not.toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({
      pagado: false,
      reconciliacion: 'sin_cambios',
    }));
  });

  it('es idempotente: consultar dos veces no descuenta stock dos veces', async () => {
    const envio = envioMock();
    const trx = { status: 'PENDING', payment_hash: HASH, envio_id: 1234, save: jest.fn() };
    PaymentGateway.findOne.mockResolvedValue(gateway);
    PaymentTransaction.findOne.mockResolvedValue(trx);
    Envio.findByPk.mockResolvedValue(envio);
    axios.post.mockResolvedValue({ data: { respuesta: true, resultado: [{ pagado: true }] } });

    await ctrl.consultarPedidoPagopar(reqBase, res());
    await ctrl.consultarPedidoPagopar(reqBase, res());

    expect(descontarStockYSnapshot).toHaveBeenCalledTimes(1);
  });

  it('no deja consultar un pedido de otro comercio', async () => {
    PaymentGateway.findOne.mockResolvedValue(gateway);
    PaymentTransaction.findOne.mockResolvedValue({ status: 'PENDING', payment_hash: HASH, envio_id: 1234 });
    Envio.findByPk.mockResolvedValue(envioMock({ usuario_id: 99 }));

    const r = res();
    await ctrl.consultarPedidoPagopar(reqBase, r);

    expect(r.status).toHaveBeenCalledWith(404);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('propaga el motivo de PagoPar cuando resultado es un string suelto', async () => {
    PaymentGateway.findOne.mockResolvedValue(gateway);
    PaymentTransaction.findOne.mockResolvedValue({ status: 'PENDING', payment_hash: HASH, envio_id: 1234, save: jest.fn() });
    Envio.findByPk.mockResolvedValue(envioMock());
    axios.post.mockResolvedValue({
      data: { respuesta: false, resultado: 'Comercio de desarrollo no habilitado o con acceso vencido.' },
    });

    const r = res();
    await ctrl.consultarPedidoPagopar(reqBase, r);

    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Comercio de desarrollo no habilitado o con acceso vencido.',
    }));
    expect(descontarStockYSnapshot).not.toHaveBeenCalled();
  });

  it('pide envio_id o hash_pedido', async () => {
    const r = res();
    await ctrl.consultarPedidoPagopar({ usuario: { id: 7 }, body: {} }, r);
    expect(r.status).toHaveBeenCalledWith(400);
  });
});

describe('Ping de credenciales', () => {
  it('usa /api/forma-pago/1.1/traer/ con sha1(private + FORMA-PAGO) y token_publico', async () => {
    PaymentGateway.findOne.mockResolvedValue(gateway);
    axios.post.mockResolvedValue({ data: { respuesta: true, resultado: [] } });

    const r = res();
    await ctrl.testPagoparConnection({ usuario: { id: 7 } }, r);

    const url = axios.post.mock.calls[0][0];
    const body = axios.post.mock.calls[0][1];
    expect(url).toBe('https://api.pagopar.com/api/forma-pago/1.1/traer/');
    expect(body.token).toBe(sha1(PRIVATE + 'FORMA-PAGO'));
    expect(body.token_publico).toBe(PUBLIC);
    expect(body.public_key).toBeUndefined();
    expect(r.json).toHaveBeenCalledWith({ success: true, message: 'Conexión exitosa' });
  });

  it('devuelve el motivo que dio PagoPar cuando resultado es un array', async () => {
    PaymentGateway.findOne.mockResolvedValue(gateway);
    axios.post.mockResolvedValue({ data: { respuesta: false, resultado: [{ datos: 'Token no valido' }] } });

    const r = res();
    await ctrl.testPagoparConnection({ usuario: { id: 7 } }, r);

    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'PagoPar rechazó la conexión: Token no valido',
    }));
  });

  // Caso real visto en staging: `resultado` llega como string suelto.
  it('devuelve el motivo cuando resultado es un string suelto', async () => {
    PaymentGateway.findOne.mockResolvedValue(gateway);
    axios.post.mockResolvedValue({
      data: { respuesta: false, resultado: 'Comercio de desarrollo no habilitado o con acceso vencido.' },
    });

    const r = res();
    await ctrl.testPagoparConnection({ usuario: { id: 7 } }, r);

    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'PagoPar rechazó la conexión: Comercio de desarrollo no habilitado o con acceso vencido.',
    }));
  });
});
