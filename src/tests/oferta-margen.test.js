// El margen que ve el comercio en sus ofertas tiene que usar lo que a ÉL le
// cuesta cada componente (mismo criterio que el "Te cuesta" del catálogo):
// un bump de un producto de Gesicom al 30% menos mostraba "margen 100%"
// porque esos productos no traen precio_costo.
jest.mock('../models', () => ({}));
jest.mock('../services/pricing.service', () => ({ ofertaVigente: () => true }));

const OfertaService = require('../services/oferta.service');

const oferta = (componentes, extra = {}) => ({
  toJSON: () => ({ id: 1, estrategia: 'order_bump', precio_normal: 26024, precio_order_bump: 18217, componentes, ...extra }),
});

describe('OfertaService.conMargen', () => {
  it('producto de Gesicom sin precio_costo: el costo es lo que el comercio le paga (precio_base)', () => {
    const r = OfertaService.conMargen(oferta([
      { cantidad: 1, producto: { id: 7, precio_costo: null, precio_base: 26024, creado_por: 1 } },
    ]), 9);
    expect(r.costo).toBe(26024);
    expect(r.margen_pct).toBe(0);
    expect(r.margen_order_bump_pct).toBeLessThan(0);
  });

  it('producto propio: el costo es su precio_costo', () => {
    const r = OfertaService.conMargen(oferta([
      { cantidad: 2, producto: { id: 8, precio_costo: 5000, precio_base: 26024, creado_por: 9 } },
    ]), 9);
    expect(r.costo).toBe(10000);
  });

  it('producto de Gesicom con precio_costo cargado: para el comercio igual cuenta precio_base', () => {
    const r = OfertaService.conMargen(oferta([
      { cantidad: 1, producto: { id: 7, precio_costo: 12000, precio_base: 26024, creado_por: 1 } },
    ]), 9);
    expect(r.costo).toBe(26024);
  });
});
