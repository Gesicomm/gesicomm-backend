'use strict';

jest.mock('../models', () => ({
  Landing: { findOne: jest.fn() }, LandingItem: { findAll: jest.fn() },
  Producto: { findAll: jest.fn(), findByPk: jest.fn() },
  Usuario: { findAll: jest.fn() }, Rol: {},
}));
for (const m of [
  '../services/tarifaDelivery.service', '../services/fulfillment.service',
  '../services/payments/paymentService', '../services/canalVenta.service', '../services/cupon.service',
  '../services/pedidoNumeracion.service', '../services/metaCapi.service', '../services/imagen.service',
  '../utils/rangoFechas', '../utils/historial', '../services/landingCodigo.service',
  '../factories/PaginaFactory',
]) jest.mock(m, () => ({}));
jest.mock('../services/aiCodeValidator.service', () => ({ detectarBloquesSinConfirmar: () => [] }));

const { Landing, LandingItem, Producto, Usuario } = require('../models');
const LandingService = require('../services/landing.service');
const LandingSimple = require('../services/landingSimple.service');

describe.each([['constructor', LandingService], ['simple', LandingSimple]])('Publicación %s', (_, service) => {
  let landing;
  beforeEach(() => {
    jest.clearAllMocks();
    landing = { id: 5, tienda_id: 3, inquilino_id: 1, tipo_pagina: 'catalogo', content: {}, save: jest.fn(), toJSON() { return { activo: this.activo }; } };
    Landing.findOne.mockResolvedValue(landing);
    jest.spyOn(LandingSimple, 'buscarPropia').mockResolvedValue(landing);
    Usuario.findAll.mockResolvedValue([{ id: 1 }]);
    LandingItem.findAll.mockResolvedValue([{ tipo: 'producto', referencia_id: 10 }]);
  });
  afterEach(() => jest.restoreAllMocks());

  test.each(['catalogo', 'funnel'])('permite publicar %s con producto del admin y cantidad cero', async tipo => {
    landing.tipo_pagina = tipo;
    landing.producto_id = 10;
    const producto = { id: 10, creado_por: 1, cantidad_disponible: 0 };
    Producto.findAll.mockResolvedValue([producto]);
    Producto.findByPk.mockResolvedValue(producto);
    await expect(service.cambiarEstado(5, 3, true)).resolves.toEqual({ activo: true });
    expect(landing.save).toHaveBeenCalledTimes(1);
  });

  test.each(['catalogo', 'funnel'])('mantiene la validación de stock del producto propio en %s', async tipo => {
    landing.tipo_pagina = tipo;
    landing.producto_id = 10;
    const producto = { id: 10, creado_por: 20, cantidad_disponible: 0 };
    Producto.findAll.mockResolvedValue([producto]);
    Producto.findByPk.mockResolvedValue(producto);
    await expect(service.cambiarEstado(5, 3, true)).rejects.toThrow('stock disponible');
    expect(landing.save).not.toHaveBeenCalled();
  });
});
