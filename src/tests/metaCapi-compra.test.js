/**
 * Purchase por la Conversions API (services/metaCapi.service.js).
 * Sin base ni red: se mockean los modelos, el cifrado y fetch. Lo que se
 * cuida acá es lo que no se ve en ningún panel: que el evento salga con el
 * pixel y el token de la tienda (Mi Tienda), con el event_id que deduplica
 * contra el Pixel del navegador, y que los datos del comprador viajen
 * SOLO hasheados.
 */

const crypto = require('crypto');

const mockCreate = jest.fn().mockResolvedValue({});
const mockTiendaFindOne = jest.fn();
jest.mock('../models', () => ({
  LandingEvento: { create: (...a) => mockCreate(...a) },
  Tienda: { findOne: (...a) => mockTiendaFindOne(...a) },
}));
jest.mock('../utils/EncryptionService', () => ({ decrypt: v => `plano:${v}` }));

const MetaCapi = require('../services/metaCapi.service');

const sha = v => crypto.createHash('sha256').update(v).digest('hex');
const tiendaConCapi = { meta_capi_activo: true, meta_pixel_id: '123456', meta_access_token: 'cifrado' };
const envio = {
  id: 55, landing_id: 9, usuario_id: 3, monto: 145735, numero_pedido: 1201,
  telefono: '0981 123-456', nombre_cliente: 'José Pérez', ciudad: 'San Lorenzo',
};

beforeEach(() => {
  mockCreate.mockClear();
  mockTiendaFindOne.mockReset();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ events_received: 1 }) });
});

describe('MetaCapiService.enviarCompra', () => {
  it('manda Purchase al pixel de la tienda, con el event_id de deduplicación y datos hasheados', async () => {
    const r = await MetaCapi.enviarCompra(envio, { tienda: tiendaConCapi, contexto: { fbp: 'fb.1.2.3', client_ip: '1.1.1.1' }, numItems: 2 });
    expect(r.enviado).toBe(true);

    const [url, opciones] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/123456\/events$/);
    const body = JSON.parse(opciones.body);
    expect(body.access_token).toBe('plano:cifrado');
    const ev = body.data[0];
    expect(ev.event_name).toBe('Purchase');
    expect(ev.event_id).toBe('purchase-55');
    expect(ev.custom_data).toEqual({ value: 145735, currency: 'PYG', order_id: '1201', num_items: 2 });
    expect(ev.user_data.ph).toEqual([sha('595981123456')]);
    expect(ev.user_data.fn).toEqual([sha('jose')]);
    expect(ev.user_data.ln).toEqual([sha('perez')]);
    expect(ev.user_data.ct).toEqual([sha('sanlorenzo')]);
    expect(ev.user_data.fbp).toBe('fb.1.2.3');
    // Nada del comprador en claro.
    expect(opciones.body).not.toMatch(/981|José|Jose|Lorenzo/);

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ landing_id: 9, tipo_evento: 'Purchase', event_id: 'purchase-55', enviado_capi: true }));
  });

  it('busca la tienda por el dueño del pedido cuando no se la pasan (confirmación de PagoPar)', async () => {
    mockTiendaFindOne.mockResolvedValue(tiendaConCapi);
    await MetaCapi.enviarCompra(envio);
    expect(mockTiendaFindOne).toHaveBeenCalledWith({ where: { usuario_id: 3 } });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('un pedido cargado a mano (sin landing) no se reporta', async () => {
    const r = await MetaCapi.enviarCompra({ ...envio, landing_id: null }, { tienda: tiendaConCapi });
    expect(r.enviado).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('sin CAPI configurado en Mi Tienda no llama a Meta, pero la compra queda en las estadísticas', async () => {
    const r = await MetaCapi.enviarCompra(envio, { tienda: { meta_capi_activo: false } });
    expect(r.enviado).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ tipo_evento: 'Purchase', enviado_capi: false }));
  });

  it('nunca rechaza aunque Meta falle', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('red caída'));
    await expect(MetaCapi.enviarCompra(envio, { tienda: tiendaConCapi })).resolves.toEqual(expect.objectContaining({ enviado: false }));
  });
});

describe('normalizarTelefono', () => {
  it.each([
    ['0981 123 456', '595981123456'],
    ['+595 981 123456', '595981123456'],
    ['981123456', '595981123456'],
    ['12', null],
    ['', null],
  ])('%s → %s', (entrada, esperado) => {
    expect(MetaCapi.normalizarTelefono(entrada)).toBe(esperado);
  });
});
