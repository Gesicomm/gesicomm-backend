jest.mock('../models', () => ({
  Producto: { findAll: jest.fn() }, ProductoCombo: { findAll: jest.fn().mockResolvedValue([]) },
  ProductoImagen: { findAll: jest.fn() }, ProductoComboImagen: { findAll: jest.fn() },
  PrecioUsuario: { findAll: jest.fn() }, Marca: {},
}));
jest.mock('../services/stockPorTienda.service', () => ({ ajustarStockALaTienda: jest.fn().mockResolvedValue() }));
jest.mock('../services/imagen.service', () => ({ serializar: i => i }));
const { Producto, ProductoImagen, PrecioUsuario } = require('../models');
const Stock = require('../services/stockPorTienda.service');
const { leerLote, imagenPublica } = require('../services/metaFeedProjection.service');
beforeEach(() => {
  jest.clearAllMocks();
  Producto.findAll.mockResolvedValue([{ id: 1, meta_content_id: 'identidad-fija', slug: 'url-nueva', nombre: 'Producto',
    precio_base: '100000', precio_minimo: '60000', cantidad_disponible: 4, creado_por: 9,
    descripcion_corta: 'Corta', descripcion_larga: 'Larga', Marca: { nombre: 'Marca' } }]);
  ProductoImagen.findAll.mockResolvedValue([{ id: 2, producto_id: 1, url: 'https://cdn.example/base.jpg' }]);
  PrecioUsuario.findAll.mockResolvedValue([{ tipo: 'producto', referencia_id: 1, precio: '150000' }]);
});
test('exporta precio comercial y contenido personalizado, sin cargar la landing ni el catálogo global', async () => {
  const tienda = { id: 3, usuario_id: 9, inquilino_id: 2 };
  const r = await leerLote(tienda, { productos: { '1': { descripcion: 'Texto propio', medios: [{ url: 'https://cdn.example/propia.jpg' }] } } }, [{ tipo: 'producto', referencia_id: 1 }], { tienda_id: 3 });
  expect(r).toEqual([expect.objectContaining({ content_id: 'identidad-fija', precio: 150000, stock: 4,
    descripcion: 'Texto propio', imagen: 'https://cdn.example/propia.jpg' })]);
  expect(Stock.ajustarStockALaTienda).toHaveBeenCalledWith(tienda, expect.anything());
  expect(PrecioUsuario.findAll.mock.calls[0][0].where).toMatchObject({ usuario_id: 9, inquilino_id: 2 });
  expect(Producto.findAll.mock.calls[0][0].attributes).not.toContain('precio_costo');
  expect(Producto.findAll.mock.calls[0][0].attributes).not.toContain('ficha_datos');
});
test('las promociones vencen por fecha y el precio nunca baja del piso vigente', async () => {
  const producto = (await Producto.findAll())[0];
  producto.descuento_porcentaje = 20; producto.descuento_fin = new Date(Date.now()+60000);
  Producto.findAll.mockResolvedValue([producto]);
  const args = [{ id: 3, usuario_id: 9, inquilino_id: 2 }, {}, [{ tipo: 'producto', referencia_id: 1 }], {}];
  expect((await leerLote(...args))[0].precio).toBe(120000);
  producto.descuento_fin = new Date(Date.now()-60000);
  expect((await leerLote(...args))[0].precio).toBe(150000);
  PrecioUsuario.findAll.mockResolvedValue([{ tipo: 'producto', referencia_id: 1, precio: 1 }]);
  expect((await leerLote(...args))[0].precio).toBe(60000);
});
test('resuelve la imagen personalizada por ID, prioriza fotos generales y omite videos', () => {
  const imgs = [{ id: 1, variante_id: 4, url: 'variante' }, { id: 2, url: 'general' }];
  expect(imagenPublica(imgs)).toBe('general');
  expect(imagenPublica(imgs, { medios: [{ tipo: 'video', url: 'video' }, { imagen_id: 2 }] })).toBe('general');
});
