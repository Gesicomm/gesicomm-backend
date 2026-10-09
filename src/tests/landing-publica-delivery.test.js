/**
 * GET público de ciudades de envío (/api/l/delivery y /api/l/:slug/delivery).
 *
 * Las ciudades salieron de la respuesta de landing/catálogo (eran el 86% del
 * catálogo) y el carrito las pide aparte. Este test blinda que el endpoint
 * nuevo sea cacheable en el borde — si no, el ahorro se pierde: pasaría a ser
 * un request a Node por cada carrito en vez de uno por ventana de cache.
 */
jest.mock('../models', () => ({
  Envio: {}, EnvioItem: {}, PaymentGateway: {}, PaymentTransaction: {},
  Landing: { findOne: jest.fn() }, Tienda: {}, Usuario: {},
}));
jest.mock('../services/landing.service', () => ({
  obtenerOpcionesDelivery: jest.fn(),
}));
for (const m of [
  '../services/metaCapi.service', '../services/builderPublicPage.service',
  '../services/payments/pagoParService', '../services/payments/confirmacionPago',
  '../services/redFulfillment.service',
]) jest.mock(m, () => ({}));

const { Landing } = require('../models');
const LandingService = require('../services/landing.service');
const ctrl = require('../controllers/landingPublica.controller');

const tienda = { id: 9, usuario_id: 77, activo: true, Usuario: { id: 77, activo: true } };
const ciudades = [{ ciudad: 'Luque', departamento: 'Central', costo: 25000, reglas: [] }];

function fakeRes() {
  const headers = {};
  return {
    headers,
    set: (k, v) => { headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(body) { this.body = body; return this; },
  };
}

function fakeReq(extra = {}) {
  return { method: 'GET', params: {}, query: {}, cookies: {}, headers: {}, tienda, ...extra };
}

beforeEach(() => {
  jest.clearAllMocks();
  LandingService.obtenerOpcionesDelivery.mockResolvedValue(ciudades);
});

describe('GET /api/l/delivery', () => {
  test('devuelve las ciudades de la tienda del hostname, cacheables en el borde', async () => {
    const res = fakeRes();
    await ctrl.deliveryPublico(fakeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ delivery_ciudades: ciudades });
    expect(LandingService.obtenerOpcionesDelivery).toHaveBeenCalledWith(77);
    const cc = res.headers['Cache-Control'];
    expect(cc).toContain('public');
    expect(cc).toContain('s-maxage=60');
  });

  test('sin tienda por hostname la resuelve por el slug (gesicomm.com/l/:slug)', async () => {
    Landing.findOne.mockResolvedValue({ Tienda: tienda });
    const res = fakeRes();
    await ctrl.deliveryPublico(fakeReq({ tienda: null, params: { slug: 'tienda-qa' } }), res);

    expect(Landing.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: 'tienda-qa' } }));
    expect(res.statusCode).toBe(200);
    expect(res.body.delivery_ciudades).toEqual(ciudades);
  });

  test('tienda inexistente → 404, sin consultar tarifas', async () => {
    Landing.findOne.mockResolvedValue(null);
    const res = fakeRes();
    await ctrl.deliveryPublico(fakeReq({ tienda: null, params: { slug: 'no-existe' } }), res);

    expect(res.statusCode).toBe(404);
    expect(LandingService.obtenerOpcionesDelivery).not.toHaveBeenCalled();
  });

  test('tienda pausada → lista vacía con cache corto, sin consultar tarifas', async () => {
    const res = fakeRes();
    await ctrl.deliveryPublico(fakeReq({ tienda: { ...tienda, activo: false } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ delivery_ciudades: [] });
    expect(LandingService.obtenerOpcionesDelivery).not.toHaveBeenCalled();
    expect(res.headers['Cache-Control']).toContain('s-maxage=30');
  });
});

describe('rutas', () => {
  test('/delivery va antes del catch-all /:slug (si no, "delivery" se toma como slug)', () => {
    const router = require('../routes/landingPublica');
    const gets = router.stack
      .filter(l => l.route && l.route.methods.get)
      .map(l => l.route.path);
    expect(gets).toContain('/delivery');
    expect(gets).toContain('/:slug/delivery');
    expect(gets.indexOf('/delivery')).toBeLessThan(gets.indexOf('/:slug'));
  });
});
