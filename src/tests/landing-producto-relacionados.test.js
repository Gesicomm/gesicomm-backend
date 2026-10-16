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

  test('la ficha no serializa el catálogo ni los diseños y bloques de otras páginas', async () => {
    const producto = { tipo: 'producto', referencia_id: 1, content_id: 'vestido', nombre: 'Vestido', categoria: 'Moda' };
    const complemento = { tipo: 'producto', referencia_id: 2, content_id: 'complemento', precio: 72000 };
    const codigo = { html: '<header>Marca</header><footer>Contacto</footer>', css: '.marca{}', js: '' };
    const ficha = { html: '<main>Ficha general</main>' };
    const propia = { html: '<main>Vestido propio</main>' };
    const portada = {
      disponible: true, slug: 'moda-qa', template: { kind: 'codigo' },
      tienda: { nombre: 'Moda' }, meta: { pixel_id: '123' }, checkout: { pasarelas: [] },
      content: {
        codigo,
        vistas: { producto: ficha, productos: { vestido: propia, otro: { html: 'NO_ENVIAR' } },
          catalogo: { html: 'NO_ENVIAR' }, categoria: { html: 'NO_ENVIAR' }, checkout: { html: 'NO_ENVIAR' }, legales: { html: 'NO_ENVIAR' } },
        venta: { recomendados: { activo: false }, inicio: {
          encabezado: { mostrar_nombre: false }, menu_links: [{ texto: 'Inicio', destino: '/' }],
          secciones: [{ html: 'NO_ENVIAR' }], banners: [{ titulo: 'NO_ENVIAR' }],
        } },
      },
      catalogo_items: [producto, complemento, ...Array.from({ length: 100 }, (_, i) => ({
        tipo: 'producto', referencia_id: i + 10, content_id: `otro-${i}`, nombre: 'NO_ENVIAR', categoria: 'Hogar',
      }))],
      categorias_catalogo: [{ nombre: 'Moda', cantidad: 2, imagen: 'foto.jpg' }, { nombre: 'Hogar', cantidad: 100 }],
      secciones: [{ tipo: 'hero', contenido: 'NO_ENVIAR' }], banner: { titulo: 'NO_ENVIAR' },
      faq: [{ respuesta: 'NO_ENVIAR' }], testimonios: [{ texto: 'NO_ENVIAR' }], filtros: { categoria: true },
    };
    LandingService.obtenerPublica.mockResolvedValue(portada);
    const data = await LandingService.obtenerProductoPublico(tienda, 'moda-qa', 'vestido');
    expect(data.producto).toEqual(producto);
    expect(data.catalogo_items).toEqual([producto, complemento]);
    expect(data.content.vistas).toEqual({ producto: ficha, productos: { vestido: propia } });
    expect(data.content.codigo).toEqual(codigo);
    expect(data.content.venta.inicio).toEqual({ encabezado: { mostrar_nombre: false }, menu_links: [{ texto: 'Inicio', destino: '/' }] });
    expect(data.categorias_catalogo).toEqual([{ nombre: 'Moda' }, { nombre: 'Hogar' }]);
    expect(data.checkout).toEqual(portada.checkout);
    expect(data.meta).toEqual(portada.meta);
    expect(JSON.stringify(data)).not.toContain('NO_ENVIAR');
    expect(portada.catalogo_items).toHaveLength(102);
    expect(portada.content.venta.inicio.banners).toHaveLength(1);
  });

  test('conserva solo los recomendados que usa la ficha del lienzo', () => {
    const producto = { content_id: 'vestido', categoria: 'Moda' };
    const catalogo = [producto, { content_id: 'hogar', categoria: 'Hogar' },
      { content_id: 'moda-1', categoria: 'Moda' }, { content_id: 'moda-2', categoria: 'Moda' }];
    const landing = { template: { kind: 'codigo' }, catalogo_items: catalogo,
      content: { venta: { recomendados: { max: 1 } } } };
    expect(LandingService.datosPublicosDeFicha(landing, producto, {}).catalogo_items.map(i => i.content_id))
      .toEqual(['vestido', 'moda-1']);
    landing.content.venta.recomendados = { modo: 'manual', items: ['hogar'], max: 1 };
    expect(LandingService.datosPublicosDeFicha(landing, producto, {}).catalogo_items.map(i => i.content_id))
      .toEqual(['vestido', 'hogar']);
  });
});
