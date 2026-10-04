jest.mock('../models', () => ({}));
jest.mock('../services/landing.service', () => ({
  resolverItemsCatalogo: jest.fn().mockResolvedValue([]),
  sincronizarItems: jest.fn().mockResolvedValue(),
  validarPayload: jest.fn().mockReturnValue([]),
}));
jest.mock('../services/landingCodigo.service', () => ({}));
jest.mock('../services/imagen.service', () => ({}));
jest.mock('../factories/PaginaFactory', () => ({}));
const Svc = require('../services/landingSimple.service');
const LandingService = require('../services/landing.service');
const items = [{ tipo: 'producto', referencia_id: 1 }, { tipo: 'combo', referencia_id: 1 }];

beforeEach(() => {
  jest.spyOn(Svc, 'obtenerTemplateRigido').mockResolvedValue({ id: 4, slug: 'bazar-hogar' });
  jest.spyOn(Svc, 'obtenerTemplateLienzoBlanco').mockResolvedValue({ id: 5, name: 'Lienzo' });
  jest.spyOn(Svc, '_crearFila').mockResolvedValue({ id: 99 });
  jest.spyOn(Svc, 'obtener').mockResolvedValue({ id: 99, items });
});
afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); });

test.each(['rigido', 'lienzo'])('%s guarda los productos elegidos antes de devolver la landing', async modo => {
  const creada = modo === 'rigido'
    ? await Svc.crear(20, 7, 4, null, items)
    : await Svc.crearLienzoBlanco(20, 7, 'Tienda', items);
  expect(LandingService.resolverItemsCatalogo).toHaveBeenCalledWith(items, 7);
  expect(LandingService.sincronizarItems).toHaveBeenCalledWith(99, expect.arrayContaining([
    expect.objectContaining(items[0]), expect.objectContaining(items[1]),
  ]));
  expect(LandingService.sincronizarItems.mock.invocationCallOrder[0]).toBeLessThan(Svc.obtener.mock.invocationCallOrder[0]);
  expect(creada.items).toEqual(items);
});

test('valida los productos antes de reemplazar la landing rígida', async () => {
  LandingService.resolverItemsCatalogo.mockRejectedValueOnce(new Error('Producto inválido'));
  await expect(Svc.crear(20, 7, 4, null, items)).rejects.toThrow('Producto inválido');
  expect(Svc._crearFila).not.toHaveBeenCalled();
});

test('rechaza una selección que supera el límite antes de reemplazar la landing', async () => {
  LandingService.validarPayload.mockReturnValueOnce(['Demasiados productos']);
  await expect(Svc.crear(20, 7, 4, null, items)).rejects.toMatchObject({ errores: ['Demasiados productos'] });
  expect(Svc._crearFila).not.toHaveBeenCalled();
});
