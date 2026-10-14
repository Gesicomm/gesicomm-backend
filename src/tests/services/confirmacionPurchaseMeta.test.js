/**
 * Purchase de Meta al confirmarse un pago de PagoPar.
 *
 * El webhook de PagoPar no trae el navegador del comprador: lo que Meta
 * necesita para asociar la compra al anuncio (user agent, URL, IP, fbc/fbp)
 * se guarda en Envio.tracking_contexto al crear el pedido, y acá se tiene
 * que leer de la fila releída con bloqueo, no del objeto del caller (que
 * puede venir cargado sin esa columna).
 */
const { confirmarPedidoPagado } = require('../../services/payments/confirmacionPago');
const MetaCapiService = require('../../services/metaCapi.service');
const { PaymentTransaction, Envio } = require('../../models');

jest.mock('../../controllers/envioController', () => ({
  descontarStockYSnapshot: jest.fn(),
  calcularAbastecimientoDesdeItems: jest.fn().mockResolvedValue({ requiere: false, costo: 0, estado: 'no_requiere' }),
}));
jest.mock('../../utils/historial', () => ({ registrarHistorial: jest.fn() }));
jest.mock('../../services/speedbox/service', () => ({ queueConfirmedOrder: jest.fn() }));
jest.mock('../../services/authTracking.service', () => ({ registrarEventoConNotificacion: jest.fn() }));
jest.mock('../../services/metaCapi.service', () => ({ enviarCompra: jest.fn() }));
jest.mock('../../models', () => ({
  sequelize: { transaction: jest.fn(fn => fn({ LOCK: { UPDATE: 'UPDATE' } })) },
  PaymentTransaction: { findByPk: jest.fn() },
  Envio: { findByPk: jest.fn() },
  Usuario: { findByPk: jest.fn().mockResolvedValue(null) },
}));

const contexto = {
  client_ip: '181.120.1.2',
  client_user_agent: 'Mozilla/5.0',
  fbc: 'fb.1.111.abc',
  fbp: 'fb.1.222.333',
  event_source_url: 'https://tienda.gesicomm.com/checkout',
  content_ids: ['producto-7'],
};

function escenario(trackingContexto) {
  const filaTrx = { id: 7, status: 'PENDING', save: jest.fn() };
  const filaEnvio = {
    id: 42, usuario_id: 3, estado: 'Pendiente', stock_descontado: false,
    tracking_contexto: trackingContexto, save: jest.fn(),
  };
  PaymentTransaction.findByPk.mockResolvedValue(filaTrx);
  Envio.findByPk.mockResolvedValue(filaEnvio);
  // El caller trae su propia copia, sin tracking_contexto.
  const envioCaller = { id: 42, usuario_id: 3, landing_id: 9, items: [{ cantidad: 2 }] };
  return { filaTrx, envioCaller };
}

beforeEach(() => jest.clearAllMocks());

describe('confirmarPedidoPagado → Purchase de Meta', () => {
  it('manda el Purchase con el navegador guardado al crear el pedido', async () => {
    const { filaTrx, envioCaller } = escenario(contexto);
    const r = await confirmarPedidoPagado(envioCaller, filaTrx);

    expect(r).toBe('confirmado');
    expect(MetaCapiService.enviarCompra).toHaveBeenCalledWith(envioCaller, {
      contexto,
      contentIds: ['producto-7'],
      numItems: 2,
    });
  });

  it('un pedido anterior a la columna se manda igual, sin contexto', async () => {
    const { filaTrx, envioCaller } = escenario(null);
    await confirmarPedidoPagado(envioCaller, filaTrx);

    expect(MetaCapiService.enviarCompra).toHaveBeenCalledWith(envioCaller, {
      contexto: {},
      contentIds: null,
      numItems: 2,
    });
  });

  it('un pago ya acreditado no repite el Purchase', async () => {
    const { filaTrx, envioCaller } = escenario(contexto);
    filaTrx.status = 'PAID';
    await confirmarPedidoPagado(envioCaller, { ...filaTrx, status: 'PENDING' });

    expect(MetaCapiService.enviarCompra).not.toHaveBeenCalled();
  });
});
