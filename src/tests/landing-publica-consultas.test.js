'use strict';

jest.mock('../models', () => ({
  Landing: { findOne: jest.fn() }, LandingItem: {}, LandingSeccion: {}, LandingTemplate: {},
}));
for (const m of [
  '../services/pricing.service', '../services/tarifaDelivery.service', '../services/fulfillment.service',
  '../services/payments/paymentService', '../services/canalVenta.service', '../services/cupon.service',
  '../services/pedidoNumeracion.service', '../services/metaCapi.service', '../services/imagen.service',
  '../utils/rangoFechas', '../utils/historial',
]) jest.mock(m, () => ({}));
const Service = require('../services/landing.service');
const { Landing } = require('../models');

describe('Lectura pública sin multiplicar contenido de la landing', () => {
  beforeEach(() => Landing.findOne.mockReset().mockResolvedValue({ activo: false }));

  test.each(['obtenerPublica', 'obtenerCatalogoPublico'])('%s conserva filtros y carga los hasMany en consultas separadas y ordenadas', async method => {
    const result = await Service[method]({ id: 69, activo: true, Usuario: { activo: true } }, 'mi-tienda');
    expect(result).toEqual({ disponible: false });
    const options = Landing.findOne.mock.calls[0][0];
    expect(options.where).toEqual({ tienda_id: 69, slug: 'mi-tienda' });
    expect(options.order).toBeUndefined();
    expect(options.include.find(i => i.as === 'items')).toMatchObject({ separate: true, order: [['orden', 'ASC']] });
    expect(options.include.find(i => i.as === 'secciones')).toMatchObject({
      separate: true, where: { producto_id: null }, order: [['orden', 'ASC']],
    });
    expect(options.include.find(i => i.as === 'template').required).toBe(false);
  });
  test.each(['obtenerPublica', 'obtenerCatalogoPublico'])('%s permite la landing sin productos/secciones y respeta la tienda de la home', async method => {
    Landing.findOne.mockResolvedValue(null);
    expect(await Service[method]({ id: 70 }, null)).toBeNull();
    expect(Landing.findOne.mock.calls[0][0].where).toEqual({ tienda_id: 70, es_home: true });
  });
});
