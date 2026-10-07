/**
 * Contrato de cache de borde del GET público de landings.
 *
 * La landing se reconstruía desde la base en cada visita. Ahora la respuesta se
 * marca cacheable para que un HIT de CDN no toque Node.
 *
 * El caso que este test existe para blindar es el preview: `preview` sale de la
 * cookie accessToken de la dueña y muestra contenido NO publicado. Si esa
 * respuesta entrara al cache compartido, el borde se la serviría a cualquier
 * visitante.
 */
jest.mock('../models', () => ({
  Envio: {}, EnvioItem: {}, PaymentGateway: {}, PaymentTransaction: {},
  Landing: { findOne: jest.fn() }, Tienda: {}, Usuario: {},
}));
jest.mock('../services/landing.service', () => ({
  obtenerPublica: jest.fn(),
  obtenerCatalogoPublico: jest.fn(),
  registrarVisita: jest.fn(),
  obtenerIdParaEvento: jest.fn(),
}));
for (const m of [
  '../services/metaCapi.service', '../services/builderPublicPage.service',
  '../services/payments/pagoParService', '../services/payments/confirmacionPago',
]) jest.mock(m, () => ({}));

const jwt = require('jsonwebtoken');
const LandingService = require('../services/landing.service');
const ctrl = require('../controllers/landingPublica.controller');

const SECRETO = process.env.JWT_SECRET || 'dev-secret-key-12345';
const tienda = { id: 9, usuario_id: 77, activo: true };

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
    method: 'GET', params: { slug: 'tienda-qa' }, query: {}, cookies: {},
    path: '/tienda-qa', headers: {}, ip: '1.2.3.4', tienda, ...extra,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('cache de borde en el GET público de la landing', () => {
  beforeEach(() => {
    LandingService.obtenerPublica.mockResolvedValue({ disponible: true, slug: 'tienda-qa' });
  });

  test('una visita pública es cacheable por el CDN y revalidada por el navegador', async () => {
    const res = fakeRes();
    await ctrl.obtenerPorSlug(fakeReq(), res);

    expect(res.statusCode).toBe(200);
    const cc = res.headers['Cache-Control'];
    expect(cc).toContain('public');
    expect(cc).toContain('s-maxage=60');
    expect(cc).toContain('max-age=0');
    expect(cc).toContain('stale-while-revalidate=300');
  });

  test('el preview de la dueña NUNCA es cacheable', async () => {
    const token = jwt.sign({ tenantId: tienda.usuario_id }, SECRETO);
    const res = fakeRes();
    await ctrl.obtenerPorSlug(fakeReq({ cookies: { accessToken: token } }), res);

    expect(res.headers['Cache-Control']).toBe('private, no-store');
    // Y se pidió de verdad en modo preview, no es que no cacheó por otra razón.
    expect(LandingService.obtenerPublica).toHaveBeenCalledWith(
      tienda, 'tienda-qa', true, expect.anything()
    );
  });

  test('un token de OTRO usuario no habilita preview ni rompe el cache', async () => {
    const token = jwt.sign({ tenantId: 999 }, SECRETO);
    const res = fakeRes();
    await ctrl.obtenerPorSlug(fakeReq({ cookies: { accessToken: token } }), res);

    expect(res.headers['Cache-Control']).toContain('public');
    expect(LandingService.obtenerPublica).toHaveBeenCalledWith(
      tienda, 'tienda-qa', false, expect.anything()
    );
  });

  test('una tienda no disponible se cachea poco, para que vuelva rápido al reactivarse', async () => {
    LandingService.obtenerPublica.mockResolvedValue({ disponible: false });
    const res = fakeRes();
    await ctrl.obtenerPorSlug(fakeReq(), res);

    expect(res.headers['Cache-Control']).toContain('s-maxage=30');
  });

  test('el POST de búsqueda no lleva headers de cache', async () => {
    LandingService.obtenerCatalogoPublico.mockResolvedValue({ disponible: true });
    const res = fakeRes();
    await ctrl.obtenerPorSlug(
      fakeReq({ method: 'POST', body: {}, path: '/tienda-qa/buscar' }),
      res
    );

    expect(res.headers['Cache-Control']).toBeUndefined();
  });

  test('el catálogo público propaga el filtro soloDescuento', async () => {
    LandingService.obtenerCatalogoPublico.mockResolvedValue({ disponible: true });
    const res = fakeRes();
    await ctrl.obtenerPorSlug(
      fakeReq({ query: { vista: 'catalogo', etiqueta: 'Oferta', soloDescuento: 'true' } }),
      res
    );

    expect(LandingService.obtenerCatalogoPublico).toHaveBeenCalledWith(
      tienda,
      'tienda-qa',
      false,
      expect.objectContaining({ etiqueta: 'Oferta', soloDescuento: true })
    );
  });
});

describe('visita', () => {
  test('se registra por POST y responde 202 sin bloquear al visitante', async () => {
    LandingService.obtenerIdParaEvento.mockResolvedValue(31);
    const res = fakeRes();
    await ctrl.registrarVisitaPublica(fakeReq({ method: 'POST' }), res);

    expect(LandingService.registrarVisita).toHaveBeenCalledWith(31);
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ ok: true });
  });

  test('una landing inexistente no registra nada y sigue devolviendo 202', async () => {
    LandingService.obtenerIdParaEvento.mockResolvedValue(null);
    const res = fakeRes();
    await ctrl.registrarVisitaPublica(fakeReq({ method: 'POST' }), res);

    expect(LandingService.registrarVisita).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ ok: false });
  });
});
