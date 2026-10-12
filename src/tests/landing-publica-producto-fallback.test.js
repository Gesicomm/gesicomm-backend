/**
 * `tienda.com/<algo>` es ambiguo: otra landing de la tienda o un producto.
 * El frontend pide /api/l/<algo> y, con el 404, recién ahí
 * /api/l/producto/<algo>. Ese 404 no lo cachea nadie (cf BYPASS), así que cada
 * ficha pagaba una ida y vuelta entera al origen antes de empezar. Ahora el
 * GET de la landing responde el producto cuando no hay landing con ese slug.
 */
jest.mock('../models', () => ({
  Envio: {}, EnvioItem: {}, PaymentGateway: {}, PaymentTransaction: {},
  Landing: { findOne: jest.fn() }, Tienda: {}, Usuario: {},
}));
jest.mock('../services/landing.service', () => ({
  obtenerPublica: jest.fn(),
  obtenerCatalogoPublico: jest.fn(),
  obtenerProductoPublico: jest.fn(),
}));
for (const m of [
  '../services/metaCapi.service', '../services/builderPublicPage.service',
  '../services/payments/pagoParService', '../services/payments/confirmacionPago',
  '../services/redFulfillment.service',
]) jest.mock(m, () => ({}));

const jwt = require('jsonwebtoken');
const LandingService = require('../services/landing.service');
const ctrl = require('../controllers/landingPublica.controller');

const SECRETO = process.env.JWT_SECRET || 'dev-secret-key-12345';
const tienda = { id: 9, usuario_id: 77, activo: true, Usuario: { id: 77, activo: true } };
const fichaAirFryer = { disponible: true, slug: 'inicio-1a2b3c', producto: { content_id: 'air-fryer' } };

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
  return {
    method: 'GET', params: { slug: 'air-fryer' }, query: {}, cookies: {},
    path: '/air-fryer', headers: {}, tienda, ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  LandingService.obtenerPublica.mockResolvedValue(null);
  LandingService.obtenerProductoPublico.mockResolvedValue(fichaAirFryer);
});

describe('GET /api/l/:slug cuando el slug es un producto', () => {
  test('responde la ficha en el mismo pedido, cacheable como /producto/:slug', async () => {
    const res = fakeRes();
    await ctrl.obtenerPorSlug(fakeReq(), res);

    expect(LandingService.obtenerProductoPublico).toHaveBeenCalledWith(tienda, null, 'air-fryer');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(fichaAirFryer);
    expect(res.headers['Cache-Control']).toContain('s-maxage=60');
  });

  test('si existe una landing con ese slug, gana la landing (como antes)', async () => {
    const landing = { disponible: true, slug: 'air-fryer' };
    LandingService.obtenerPublica.mockResolvedValue(landing);
    const res = fakeRes();
    await ctrl.obtenerPorSlug(fakeReq(), res);

    expect(res.body).toBe(landing);
    expect(LandingService.obtenerProductoPublico).not.toHaveBeenCalled();
  });

  test('ni landing ni producto → 404', async () => {
    LandingService.obtenerProductoPublico.mockResolvedValue(null);
    const res = fakeRes();
    await ctrl.obtenerPorSlug(fakeReq({ params: { slug: 'no-existe' } }), res);

    expect(res.statusCode).toBe(404);
  });

  test('con la cookie de la dueña la ficha igual sale pública (la ruta de producto no tiene preview)', async () => {
    const token = jwt.sign({ tenantId: tienda.usuario_id }, SECRETO);
    const res = fakeRes();
    await ctrl.obtenerPorSlug(fakeReq({ cookies: { accessToken: token } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toContain('public');
  });

  test('el catálogo y las páginas legales no caen al producto', async () => {
    LandingService.obtenerCatalogoPublico.mockResolvedValue(null);
    const resCat = fakeRes();
    await ctrl.obtenerPorSlug(fakeReq({ query: { vista: 'catalogo' } }), resCat);
    const resLegal = fakeRes();
    await ctrl.obtenerPorSlug(fakeReq({ query: { tipo_pagina: 'politica_envio' } }), resLegal);

    expect(resCat.statusCode).toBe(404);
    expect(resLegal.statusCode).toBe(404);
    expect(LandingService.obtenerProductoPublico).not.toHaveBeenCalled();
  });

  test('sin slug (el inicio) no busca producto', async () => {
    const res = fakeRes();
    await ctrl.obtenerPorSlug(fakeReq({ params: {} }), res);

    expect(res.statusCode).toBe(404);
    expect(LandingService.obtenerProductoPublico).not.toHaveBeenCalled();
  });
});
