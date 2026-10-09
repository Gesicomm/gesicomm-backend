jest.mock('../models', () => ({
  sequelize: {
    transaction: jest.fn(),
    where: jest.fn((...args) => args),
    fn: jest.fn((...args) => args),
    col: jest.fn((value) => value),
  },
  Categoria: {},
  Producto: {},
  ProductoImagen: {},
}));
jest.mock('../services/producto.service', () => ({}));
jest.mock('../services/productoVariante.service', () => ({}));

const {
  parseCsv,
  filasAObjetos,
  agruparPorHandle,
} = require('../services/productoImportacionShopify.service');

describe('Importación Shopify', () => {
  test('parsea CSV con HTML multilinea y agrupa imágenes por handle', () => {
    const csv = [
      'Handle,Title,Body (HTML),Variant SKU,Variant Price,Image Src',
      'vaso-termico,Vaso térmico,"<p>Línea 1</p>',
      '<p>Línea 2</p>",VT-1,120000,https://cdn.test/1.webp',
      'vaso-termico,,,,,https://cdn.test/2.webp',
    ].join('\n');

    const registros = filasAObjetos(parseCsv(csv));
    const grupos = agruparPorHandle(registros);

    expect(registros).toHaveLength(2);
    expect(registros[0]['Body (HTML)']).toContain('Línea 2');
    expect(grupos).toHaveLength(1);
    expect(grupos[0].rows).toHaveLength(2);
  });

  test('rechaza archivos que no tienen columnas mínimas de Shopify', () => {
    expect(() => filasAObjetos([['nombre', 'precio'], ['Producto', '1000']]))
      .toThrow('El archivo no parece ser una exportación de productos de Shopify.');
  });
});
