/**
 * LandingService.primeraPaginaLienzo — qué productos de una lista MANUAL
 * larga viajan completos en la respuesta de la landing. El filtro es del
 * servidor: el navegador solo pinta lo que recibe, así que lo que acá quede
 * afuera no aparece en el inicio, y lo que sobre vuelve a inflar la
 * respuesta. Modelos mockeados: se verifica la selección, no la base.
 */

const mockProductoFindAll = jest.fn();
const mockComboFindAll = jest.fn();
const mockImagenFindAll = jest.fn();
jest.mock('../models', () => ({
  Producto: { findAll: (...a) => mockProductoFindAll(...a) },
  ProductoCombo: { findAll: (...a) => mockComboFindAll(...a) },
  ProductoImagen: { findAll: (...a) => mockImagenFindAll(...a) },
  Usuario: {},
  Rol: {},
}));
jest.mock('../services/imagen.service', () => ({ serializar: img => ({ url: img.url }) }));
for (const m of [
  '../services/pricing.service', '../services/tarifaDelivery.service', '../services/fulfillment.service',
  '../services/payments/paymentService', '../services/canalVenta.service', '../services/cupon.service',
  '../services/pedidoNumeracion.service', '../services/metaCapi.service',
  '../utils/rangoFechas', '../utils/historial',
]) jest.mock(m, () => ({}));

const LandingService = require('../services/landing.service');

const N = 25; // PRIMERA_PAGINA_LIENZO
const item = (id, extra = {}) => ({ tipo: 'producto', referencia_id: id, orden: id, mostrar_en_inicio: true, ...extra });
const producto = (id, categoria = 'Cocina') => ({ id, slug: `prod-${id}`, categoria: { nombre: categoria } });
const idsDe = items => items.map(i => `${i.tipo}:${i.referencia_id}`);

/** 366 productos elegidos a mano: 1-200 Cocina, 201-300 Audio, 301-366 Hogar. */
function tiendaGrande() {
  const items = Array.from({ length: 366 }, (_, i) => item(i + 1));
  const categoriaDe = id => (id <= 200 ? 'Cocina' : id <= 300 ? 'Audio' : 'Hogar');
  mockProductoFindAll.mockResolvedValue(items.map(i => producto(i.referencia_id, categoriaDe(i.referencia_id))));
  return items;
}

beforeEach(() => {
  mockProductoFindAll.mockReset().mockResolvedValue([]);
  mockComboFindAll.mockReset().mockResolvedValue([]);
  mockImagenFindAll.mockReset().mockResolvedValue([]);
});

describe('primeraPaginaLienzo', () => {
  it('sin nada configurado manda solo la primera página, en el orden del comercio', async () => {
    const items = tiendaGrande();
    const res = await LandingService.primeraPaginaLienzo({ content: {} }, items);
    expect(res.items).toHaveLength(N);
    expect(idsDe(res.items)).toEqual(idsDe(items.slice(0, N)));
    expect(res.total).toBe(366);
  });

  it('el total y las categorías no cuentan lo que el filtro de la tienda deja afuera', async () => {
    const items = tiendaGrande();
    // La base, con el filtro aplicado, ya no devuelve los 66 de Hogar.
    mockProductoFindAll.mockResolvedValue(items.slice(0, 300).map(i => producto(i.referencia_id, i.referencia_id <= 200 ? 'Cocina' : 'Audio')));
    const whereProducto = { creado_por: 20 };
    const res = await LandingService.primeraPaginaLienzo({ content: {} }, items, { whereProducto });
    expect(mockProductoFindAll.mock.calls[0][0].where).toMatchObject(whereProducto);
    expect(res.total).toBe(300);
    expect(res.categorias.map(c => c.nombre)).toEqual(['Audio', 'Cocina']);
  });

  it('la pasada sobre toda la lista es liviana: sin precios ni imágenes de los 366', async () => {
    const items = tiendaGrande();
    await LandingService.primeraPaginaLienzo({ content: {} }, items);
    expect(mockProductoFindAll).toHaveBeenCalledTimes(1);
    expect(mockProductoFindAll.mock.calls[0][0].attributes).toEqual(['id', 'meta_content_id', 'slug']);
    // Imágenes: una consulta, solo para la foto de cada categoría (3), nunca para todo el catálogo.
    expect(mockImagenFindAll).toHaveBeenCalledTimes(1);
    const idsFoto = Object.getOwnPropertySymbols(mockImagenFindAll.mock.calls[0][0].where.producto_id)
      .map(s => mockImagenFindAll.mock.calls[0][0].where.producto_id[s])[0];
    expect(idsFoto).toEqual([1, 201, 301]);
  });

  it('suma lo que la configuración nombra aunque esté después del corte', async () => {
    const items = tiendaGrande();
    const content = {
      venta: {
        principal_id: 350,
        destacados: ['prod-320'],
        recomendados: { items: ['prod-250'] },
        checkout_recomendados: { items: ['prod-251'] },
        urgencia: { producto_id: 'prod-260' },
        inicio: {
          productos_categoria: { items: ['prod-330', 'prod-5'] },
          secciones: [{ tipo: 'manual', productos: ['prod-340'] }],
        },
      },
      codigo: {
        html: `<div data-gesicomm-lista="productos_manual" data-gesicomm-productos-curados='[{"id":"prod-360","nombre":"X"}]'></div>
               <button data-gesicomm-comprar="prod-361">Comprar</button><button data-gesicomm-comprar="principal">Comprar</button>`,
      },
    };
    const res = await LandingService.primeraPaginaLienzo({ content }, items);
    const ids = res.items.map(i => i.referencia_id);
    expect(ids).toEqual(expect.arrayContaining([350, 320, 250, 251, 260, 330, 340, 360, 361]));
    expect(res.items).toHaveLength(N + 9); // prod-5 ya estaba en la primera página
    // Conserva el orden del comercio: los sumados no saltan adelante.
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('una vitrina por categoría recibe sus primeros productos aunque la categoría empiece después del corte', async () => {
    const items = tiendaGrande();
    items[300].mostrar_en_inicio = false; // el 301 está oculto del inicio: no cuenta para la vitrina
    const content = { venta: { inicio: { secciones: [{ activo: true, tipo: 'categoria', categoria: 'Hogar', limite: 3 }] } } };
    const res = await LandingService.primeraPaginaLienzo({ content }, items);
    expect(res.items.filter(i => i.referencia_id > 300).map(i => i.referencia_id)).toEqual([302, 303, 304]);
  });

  it('trae el producto de la ficha pedida aunque esté al final de la lista', async () => {
    const items = tiendaGrande();
    const res = await LandingService.primeraPaginaLienzo({ content: {} }, items, { asegurarContentId: 'prod-366' });
    expect(res.items).toHaveLength(N + 1);
    expect(res.items.at(-1).referencia_id).toBe(366);
  });

  it('categorías y total se calculan sobre TODA la lista, no sobre lo que viaja', async () => {
    const items = tiendaGrande();
    mockImagenFindAll.mockResolvedValue([
      { producto_id: 201, url: 'https://cdn.test/audio.webp' },
      { producto_id: 201, url: 'https://cdn.test/audio-2.webp' },
      { producto_id: 1, url: 'https://cdn.test/cocina.webp' },
    ]);
    const res = await LandingService.primeraPaginaLienzo({ content: {} }, items);
    expect(res.categorias).toEqual([
      { nombre: 'Audio', cantidad: 100, imagen: 'https://cdn.test/audio.webp' },
      { nombre: 'Cocina', cantidad: 200, imagen: 'https://cdn.test/cocina.webp' },
      { nombre: 'Hogar', cantidad: 66, imagen: null },
    ]);
  });

  it('un producto dado de baja no cuenta ni viaja, y deja su lugar al siguiente', async () => {
    const items = Array.from({ length: 150 }, (_, i) => item(i + 1));
    mockProductoFindAll.mockResolvedValue(items.filter(i => i.referencia_id !== 1).map(i => producto(i.referencia_id)));
    const res = await LandingService.primeraPaginaLienzo({ content: {} }, items);
    expect(res.total).toBe(149);
    expect(res.items[0].referencia_id).toBe(2);
    expect(res.items).toHaveLength(N);
    expect(res.items.at(-1).referencia_id).toBe(N + 1);
  });

  it('combos: se identifican como combo-ID y usan la categoría y la foto de su producto padre', async () => {
    const items = [...Array.from({ length: 120 }, (_, i) => item(i + 1)), { tipo: 'combo', referencia_id: 9, orden: 999, mostrar_en_inicio: true }];
    mockProductoFindAll.mockResolvedValue(items.filter(i => i.tipo === 'producto').map(i => producto(i.referencia_id)));
    mockComboFindAll.mockResolvedValue([{ id: 9, producto_padre: { id: 77, categoria: { nombre: 'Packs' } } }]);
    const res = await LandingService.primeraPaginaLienzo({ content: { venta: { destacados: ['combo-9'] } } }, items);
    expect(res.items.at(-1)).toMatchObject({ tipo: 'combo', referencia_id: 9 });
    expect(res.categorias.find(c => c.nombre === 'Packs')).toMatchObject({ cantidad: 1 });
    expect(res.total).toBe(121);
  });
});

describe('contentIdsReferidosLienzo', () => {
  it('ignora valores que no son un content_id y tiene tope', () => {
    const muchos = Array.from({ length: 500 }, (_, i) => `prod-${i}`);
    const ids = LandingService.contentIdsReferidosLienzo({
      venta: { destacados: ['ok-1', '<script>', '', null, { id: 'ok-2' }, 42], recomendados: { items: muchos } },
    });
    expect(ids).toEqual(expect.arrayContaining(['ok-1', 'ok-2']));
    expect(ids).not.toContain('<script>');
    expect(ids.length).toBe(200);
  });

  it('acepta el nombre legado inicio_comercial', () => {
    expect(LandingService.contentIdsReferidosLienzo({ venta: { inicio_comercial: { productos_categoria: { items: ['a-1'] } } } })).toEqual(['a-1']);
  });
});
