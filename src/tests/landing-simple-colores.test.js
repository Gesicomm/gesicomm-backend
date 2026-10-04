jest.mock('../models', () => ({}));
jest.mock('../services/landing.service', () => ({}));
jest.mock('../services/landingCodigo.service', () => ({}));
jest.mock('../services/imagen.service', () => ({}));
jest.mock('../factories/PaginaFactory', () => ({}));
const Svc = require('../services/landingSimple.service');
describe('Colores al crear un template rígido', () => {
  beforeEach(() => {
    jest.spyOn(Svc, 'obtenerTemplateRigido').mockResolvedValue({ id: 4, slug: 'bazar-hogar' });
    jest.spyOn(Svc, '_crearFila').mockResolvedValue({ id: 99 });
    jest.spyOn(Svc, 'obtener').mockResolvedValue({ id: 99 });
  });
  afterEach(() => jest.restoreAllMocks());
  test('guarda la paleta elegida durante la creación', async () => {
    await Svc.crear(20, 7, 4, { fondo: '#FBFAF7', texto: '#292722', acento: '#A95843' });
    expect(Svc._crearFila).toHaveBeenCalledWith(20, 7, expect.any(Object), expect.objectContaining({ color_fondo: '#FBFAF7', color_texto: '#292722', color_primario: '#A95843' }));
  });
  test('sin paleta propia conserva la herencia de tienda', async () => {
    await Svc.crear(20, 7, 4);
    const extra = Svc._crearFila.mock.calls[0][3];
    expect(extra.color_fondo).toBeUndefined();
    expect(extra.color_texto).toBeUndefined();
    expect(extra.color_primario).toBeUndefined();
  });
  test.each([{}, 'rojo', { fondo: '#fff', texto: '#292722', acento: '#A95843' }])('rechaza una paleta inválida antes de reemplazar una landing: %j', async colores => {
    await expect(Svc.crear(20, 7, 4, colores)).rejects.toThrow('paleta');
    expect(Svc._crearFila).not.toHaveBeenCalled();
  });
});
