/**
 * El endpoint que consulta el resultado de un pago es PUBLICO: lo abre el
 * comprador al volver de PagoPar, con el hash en la URL. Ese hash no es
 * secreto (viaja en el historial, el referrer, los logs), asi que lo que se
 * responda ahi queda al alcance de cualquiera que lo tenga.
 *
 * Estos tests fijan las dos cosas que no pueden pasar:
 *   1. filtrar `token` — es sha1(private_key + hash_pedido), o sea lo mismo
 *      que el webhook acepta como prueba de autenticidad: con eso se puede
 *      falsificar un aviso y marcar un pedido como pagado;
 *   2. filtrar `documento` — la cedula del comprador.
 */
const ctrl = require('../../controllers/landingPublica.controller');
const PagoParService = require('../../services/payments/pagoParService');
const { Envio, PaymentGateway, PaymentTransaction } = require('../../models');

jest.mock('../../models', () => ({
  Envio: { findByPk: jest.fn() },
  EnvioItem: {},
  PaymentGateway: { findOne: jest.fn() },
  PaymentTransaction: { findOne: jest.fn() },
  Tienda: { findOne: jest.fn() },
  Landing: { findOne: jest.fn() },
  sequelize: { transaction: jest.fn(fn => fn('TRX')) },
}));
jest.mock('../../services/payments/pagoParService');
jest.mock('../../services/payments/confirmacionPago', () => ({
  confirmarPedidoPagado: jest.fn().mockResolvedValue('sin_cambios'),
}));
// resolverTiendaYLanding usa req.tienda (lo pone el middleware) y consulta el
// landing_id; sin este mock la peticion muere antes de llegar al saneo y los
// tests de filtracion pasarian en falso.
jest.mock('../../services/landing.service', () => ({
  obtenerIdParaEvento: jest.fn().mockResolvedValue(null),
}));

const HASH = 'ad57c9c94f745fdd9bc9093bb4092976';
const TIENDA = { id: 1, usuario_id: 3, nombre: 'sommix' };

// Lo que PagoPar devuelve de verdad, tal cual lo vimos en el simulador.
const CRUDO_DE_PAGOPAR = {
  pagado: true,
  numero_comprobante_interno: '1234567890',
  ultimo_mensaje_error: null,
  forma_pago: 'Tarjetas de crédito y débito',
  fecha_pago: '2026-09-12 03:20:30',
  monto: '40000.00',
  fecha_maxima_pago: '2026-09-13 03:20:30',
  hash_pedido: HASH,
  numero_pedido: '29052519',
  cancelado: false,
  forma_pago_identificador: '26',
  token: '50548663dad4339c2377abd6e599544f80dbd60a',   // <- sha1(private + hash)
  documento: '800590',                                  // <- cedula del comprador
  entorno: null,
};

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

beforeEach(() => {
  jest.clearAllMocks();
  PaymentTransaction.findOne.mockResolvedValue({ envio_id: 99, status: 'PENDING', save: jest.fn() });
  Envio.findByPk.mockResolvedValue({ id: 99, usuario_id: 3, monto: 40000, estado: 'Pendiente', items: [] });
  PaymentGateway.findOne.mockResolvedValue({ private_key: 'priv', public_key: 'pub' });
  PagoParService.consultarEstadoPedido.mockResolvedValue({ pagado: true, datos: CRUDO_DE_PAGOPAR });
});

function req(hash = HASH) {
  // `tienda` viene del middleware resolverTiendaOpcional.
  return { params: { hash }, tienda: TIENDA, hostname: 'sommix.gesicomm.com', get: () => 'sommix.gesicomm.com' };
}

describe('GET /api/l/pagopar/resultado/:hash — no filtra secretos', () => {
  it('NUNCA devuelve el token de PagoPar', async () => {
    const r = res();
    await ctrl.resultadoPago(req(), r);

    const cuerpo = JSON.stringify(r.json.mock.calls[0][0]);
    // Guarda: si la peticion murio antes (404/400), este test no probaria nada.
    expect(r.status).toHaveBeenCalledWith(200);
    expect(cuerpo).toContain('"pedido_id"');
    expect(cuerpo).not.toContain('50548663dad4339c2377abd6e599544f80dbd60a');
    expect(cuerpo).not.toMatch(/"token"/);
  });

  it('NUNCA devuelve el documento del comprador', async () => {
    const r = res();
    await ctrl.resultadoPago(req(), r);

    const cuerpo = JSON.stringify(r.json.mock.calls[0][0]);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(cuerpo).toContain('"pedido_id"');
    expect(cuerpo).not.toContain('800590');
    expect(cuerpo).not.toMatch(/"documento"/);
  });

  it('sí devuelve lo que el comprador necesita ver', async () => {
    const r = res();
    await ctrl.resultadoPago(req(), r);

    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({
      pagado: true,
      pedido_id: 99,
      pagopar: expect.objectContaining({
        pagado: true,
        monto: '40000.00',
        forma_pago: 'Tarjetas de crédito y débito',
      }),
    }));
  });

  it('404 si la transacción es de otra tienda', async () => {
    // Mismo hash, pero el pedido pertenece a otro usuario.
    Envio.findByPk.mockResolvedValue({ id: 99, usuario_id: 77, items: [] });
    const r = res();
    await ctrl.resultadoPago(req(), r);

    expect(r.status).toHaveBeenCalledWith(404);
    expect(PagoParService.consultarEstadoPedido).not.toHaveBeenCalled();
  });
});
