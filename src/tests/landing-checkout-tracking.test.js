/**
 * Checkout público → datos para el Purchase de Meta.
 *
 * Con PagoPar el Purchase sale recién cuando se confirma el pago (webhook),
 * sin el navegador del comprador. Por eso crearCheckout guarda en
 * Envio.tracking_contexto lo que Meta necesita para asociar la compra al
 * anuncio. Con contra entrega el Purchase sale en el mismo request y no hace
 * falta guardar nada. Sin base ni red: se mockean modelos y servicios.
 */

const mockEnvioCreate = jest.fn();
jest.mock('../models', () => new Proxy({
  sequelize: { transaction: fn => fn({}) },
  Envio: { create: (...a) => mockEnvioCreate(...a) },
}, { get: (obj, k) => (k in obj ? obj[k] : {}) }));
jest.mock('../utils/historial', () => ({ registrarHistorial: jest.fn() }));
jest.mock('../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('../services/payments/paymentService', () => ({
  getPublicGateways: jest.fn().mockResolvedValue([{ provider: 'pagopar' }]),
  createTransaction: jest.fn().mockResolvedValue({ payment_url: 'https://pagopar.test/pagar' }),
}));
jest.mock('../services/canalVenta.service', () => ({ idPorSlug: jest.fn().mockResolvedValue(1) }));
jest.mock('../services/cupon.service', () => ({ validar: jest.fn(), registrarUso: jest.fn() }));
jest.mock('../services/pedidoNumeracion.service', () => ({ reservarNumeroPedido: jest.fn().mockResolvedValue(77), reservarNumeroPedidoTienda: jest.fn().mockResolvedValue(1) }));
jest.mock('../services/metaCapi.service', () => ({
  enviarCompra: jest.fn(),
  eventIdCompra: envio => `purchase-${envio.id}`,
}));

const LandingService = require('../services/landing.service');
const MetaCapiService = require('../services/metaCapi.service');

const tienda = { id: 5, usuario_id: 3, nombre: 'Alibaguay' };
const contexto = {
  client_ip: '181.120.1.2',
  client_user_agent: 'Mozilla/5.0',
  fbc: 'fb.1.111.abc',
  fbp: 'fb.1.222.333',
  event_source_url: 'https://tienda.gesicomm.com/checkout',
};
const datos = (extra = {}) => ({
  nombre_cliente: 'Ana Benítez', telefono: '0981123456', ciudad: 'Luque', direccion: 'Calle 1', documento: '1234567',
  items: [{ content_id: 'producto-7', cantidad: 2 }],
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockEnvioCreate.mockImplementation(async (fila) => ({ ...fila, id: 900 }));
  jest.spyOn(LandingService, 'resolverCarrito').mockResolvedValue({
    landing: { id: 9 },
    itemsResueltos: [
      { content_id: 'producto-7', producto_id: 7, cantidad: 2, precio_unitario: 50000, subtotal: 100000 },
      { content_id: 'producto-8', producto_id: 8, cantidad: 1, precio_unitario: 20000, subtotal: 20000 },
      { content_id: 'producto-7', producto_id: 7, oferta_id: 3, cantidad: 1, precio_unitario: 10000, subtotal: 10000 },
    ],
  });
  jest.spyOn(LandingService, 'obtenerOpcionesDelivery').mockResolvedValue([]);
});

describe('LandingService.crearCheckout — tracking de Meta', () => {
  it('con PagoPar guarda el navegador y los productos para el Purchase diferido', async () => {
    const r = await LandingService.crearCheckout(tienda, 'tienda', datos({ payment_method: 'pagopar' }), contexto);
    expect(r.numero_pedido_tienda).toBe(1);
    expect(r.numero_pedido_visible).toBe(`${tienda.nombre.toUpperCase().slice(0, 3)}-1001`);

    expect(mockEnvioCreate.mock.calls[0][0].tracking_contexto).toEqual({
      ...contexto,
      content_ids: ['producto-7', 'producto-8'],
    });
    // Todavía no hay venta: el Purchase sale al confirmarse el pago.
    expect(MetaCapiService.enviarCompra).not.toHaveBeenCalled();
    expect(r.purchase_event_id).toBeNull();
  });

  it('contra entrega manda el Purchase en el momento, con productos, y no guarda contexto', async () => {
    const r = await LandingService.crearCheckout(tienda, 'tienda', datos({ payment_method: 'efectivo' }), contexto);

    expect(mockEnvioCreate.mock.calls[0][0].tracking_contexto).toBeNull();
    expect(MetaCapiService.enviarCompra).toHaveBeenCalledWith(
      expect.objectContaining({ id: 900 }),
      expect.objectContaining({ contexto, contentIds: ['producto-7', 'producto-8'], numItems: 4 }),
    );
    expect(r.purchase_event_id).toBe('purchase-900');
  });
});
