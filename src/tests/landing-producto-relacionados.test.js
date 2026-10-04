const mockLandingFindOne = jest.fn();
const mockListarRelacionados = jest.fn();
jest.mock('../models', () => ({
  Landing: { findOne: (...a) => mockLandingFindOne(...a) },
  LandingSeccion: { findAll: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../services/producto.service', () => ({ listarRelacionados: (...a) => mockListarRelacionados(...a) }));
for (const m of [
  '../services/pricing.service', '../services/tarifaDelivery.service', '../services/fulfillment.service',
  '../services/payments/paymentService', '../services/canalVenta.service', '../services/cupon.service',
  '../services/pedidoNumeracion.service', '../services/metaCapi.service', '../services/imagen.service',
  '../services/precioUsuario.service', '../utils/rangoFechas', '../utils/historial',
]) jest.mock(m, () => ({}));
const LandingService = require('../services/landing.service');

describe('Relacionados propios de la landing publicada', () => {
  const tienda = { id: 20, inquilino_id: 7 };
  beforeEach(() => {
    jest.spyOn(LandingService, 'obtenerPublica').mockResolvedValue({
      disponible: true, slug: 'moda-qa', content: { ficha_moda: {} },
      catalogo_items: [
        { tipo: 'producto', referencia_id: 1, content_id: 'vestido', nombre: 'Vestido' },
        { tipo: 'producto', referencia_id: 2, content_id: 'complemento', precio: 72000, precio_antes: 100000 },
      ],
    });
    mockLandingFindOne.mockReset().mockResolvedValue({
      content: { productos: { '1': { relacionados_titulo: 'Looks elegidos QA', relacionados: [2] } } },
    });
    mockListarRelacionados.mockReset().mockResolvedValue({
      titulo: 'Looks elegidos QA', automatico: false,
      items: [{ id: 2, slug: 'complemento', precio: 80000, precio_tachado: 90000 }, { id: 3, slug: 'fuera-catalogo', precio: 90000 }],
    });
  });
  afterEach(() => jest.restoreAllMocks());
  test('conserva título, curación y precio publicado sin exponer overrides del editor', async () => {
    const data = await LandingService.obtenerProductoPublico(tienda, 'moda-qa', 'vestido');
    expect(mockLandingFindOne).toHaveBeenCalledWith({ where: { tienda_id: 20, slug: 'moda-qa' }, attributes: ['content'] });
    expect(mockListarRelacionados).toHaveBeenCalledWith(1, 7, { idsForzados: [2], titulo: 'Looks elegidos QA' });
    expect(data.relacionados.titulo).toBe('Looks elegidos QA');
    expect(data.relacionados.items).toEqual([{ id: 2, slug: 'complemento', precio: 72000, precio_tachado: 90000, precio_ancla: 100000, etiqueta: null }]);
    expect(data.content.productos).toBeUndefined();
  });
  test('una selección vacía se respeta y no se convierte en relacionados automáticos', async () => {
    mockLandingFindOne.mockResolvedValue({ content: { productos: { '1': { relacionados: [], relacionados_titulo: 'Sin extras QA' } } } });
    await LandingService.obtenerProductoPublico(tienda, 'moda-qa', 'vestido');
    expect(mockListarRelacionados).toHaveBeenCalledWith(1, 7, { idsForzados: [], titulo: 'Sin extras QA' });
  });
});
