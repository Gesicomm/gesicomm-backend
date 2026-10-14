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

  it('manda los productos (mismos content_id que el Pixel) y el correo hasheado', async () => {
    await MetaCapi.enviarCompra({ ...envio, email: '  Jose@Correo.com.py ' }, {
      tienda: tiendaConCapi, contentIds: ['producto-7', 'combo-3', '', null], numItems: 3,
    });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const ev = body.data[0];
    expect(ev.custom_data).toEqual({
      value: 145735, currency: 'PYG', order_id: '1201', num_items: 3,
      content_ids: ['producto-7', 'combo-3'], content_type: 'product',
    });
    expect(ev.user_data.em).toEqual([sha('jose@correo.com.py')]);
    expect(global.fetch.mock.calls[0][1].body).not.toMatch(/correo/i);
  });

  it('un correo inválido no viaja', async () => {
    await MetaCapi.enviarCompra({ ...envio, email: 'sin-arroba' }, { tienda: tiendaConCapi });
    const ev = JSON.parse(global.fetch.mock.calls[0][1].body).data[0];
    expect(ev.user_data.em).toBeUndefined();
  });

  it('el Purchase de PagoPar usa el navegador guardado al crear el pedido', async () => {
    const contexto = {
      client_ip: '181.120.1.2', client_user_agent: 'Mozilla/5.0', fbc: 'fb.1.111.abc', fbp: 'fb.1.222.333',
      event_source_url: 'https://tienda.gesicomm.com/checkout',
    };
    await MetaCapi.enviarCompra(envio, { tienda: tiendaConCapi, contexto });
    const ev = JSON.parse(global.fetch.mock.calls[0][1].body).data[0];
    expect(ev.event_source_url).toBe('https://tienda.gesicomm.com/checkout');
    expect(ev.user_data).toEqual(expect.objectContaining({
      client_ip_address: '181.120.1.2', client_user_agent: 'Mozilla/5.0', fbc: 'fb.1.111.abc', fbp: 'fb.1.222.333',
    }));
  });
});

describe('fbc desde el fbclid de la URL', () => {
  it('sin cookie _fbc se arma con el fbclid de event_source_url', async () => {
    await MetaCapi.enviarEvento(tiendaConCapi, {
      landing_id: 9, event_name: 'PageView', event_id: 'pv-1',
      event_source_url: 'https://tienda.gesicomm.com/?utm_source=fb&fbclid=IwAR123',
    });
    const ev = JSON.parse(global.fetch.mock.calls[0][1].body).data[0];
    expect(ev.user_data.fbc).toMatch(/^fb\.1\.\d{13}\.IwAR123$/);
  });

  it('la cookie _fbc gana sobre la URL', async () => {
    await MetaCapi.enviarEvento(tiendaConCapi, {
      landing_id: 9, event_name: 'PageView', event_id: 'pv-2', fbc: 'fb.1.5.cookie',
      event_source_url: 'https://tienda.gesicomm.com/?fbclid=otro',
    });
    const ev = JSON.parse(global.fetch.mock.calls[0][1].body).data[0];
    expect(ev.user_data.fbc).toBe('fb.1.5.cookie');
  });

  it.each([null, '', 'no es una url', 'https://tienda.gesicomm.com/sin-clic'])('%p → sin fbc', (url) => {
    expect(MetaCapi.fbcDesdeUrl(url)).toBeNull();
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
