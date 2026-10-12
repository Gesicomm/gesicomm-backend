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
  estructurarContenidoShopify,
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

  test('estructura el HTML de Shopify en campos de ficha pública', () => {
    const contenido = estructurarContenidoShopify({
      Title: 'Masajeador Muscular con 4 Cabezales',
      'SEO Description': '',
      'Body (HTML)': `
        <h3>Sencillo</h3>
        <p>Relajá tus músculos de forma práctica desde casa.</p>
        <p>Está diseñado para ayudar a aliviar la tensión muscular.</p>
        <h3><img src="https://cdn.test/foto.webp"></h3>
        <h3>Beneficios</h3>
        <ul>
          <li>Ayuda a relajar músculos tensos o cansados.</li>
          <li>Ideal para usar después de entrenar.</li>
        </ul>
        <h3>Características</h3>
        <ul>
          <li>Diseño recargable.</li>
          <li>Incluye 4 cabezales intercambiables.</li>
        </ul>
        <h3>Ideal para</h3>
        <ul><li>Cuello.</li><li>Espalda.</li></ul>
        <h2>Opciones de envío y pago</h2>
        <p>Asunción: envío gratis con pago anticipado.</p>
      `,
    });

    expect(contenido.descripcion).toBe('Relajá tus músculos de forma práctica desde casa.\n\nEstá diseñado para ayudar a aliviar la tensión muscular.');
    expect(contenido.beneficios).toEqual([
      { icono: 'CheckCircle2', titulo: 'Ayuda a relajar músculos tensos o cansados', texto: '' },
      { icono: 'CheckCircle2', titulo: 'Ideal para usar después de entrenar', texto: '' },
    ]);
    expect(contenido.fichaDatos.beneficios_rapidos).toContain('Incluye 4 cabezales intercambiables');
    expect(contenido.fichaDatos.basico_descripcion_encabezado).toBe('Sencillo');
    expect(contenido.fichaDatos.basico_usos).toEqual([
      { paso: '1', titulo: 'Cuello', texto: '' },
      { paso: '2', titulo: 'Espalda', texto: '' },
    ]);
    expect(contenido.descripcionLarga).toContain('Beneficios\n- Ayuda a relajar músculos tensos o cansados.');
    expect(contenido.descripcionLarga).not.toContain('Opciones de envío y pago');
    expect(contenido.descripcionLarga).not.toContain('Asunción: envío gratis con pago anticipado');
    expect(contenido.fichaDatos.beneficios_rapidos).not.toContain('Asunción: envío gratis con pago anticipado');
    expect(contenido.faq).toHaveLength(3);
  });

  test('si Shopify no trae introducción no usa todo el HTML como descripción', () => {
    const contenido = estructurarContenidoShopify({
      Title: 'Pulsera activity tracker',
      'SEO Description': '',
      'Body (HTML)': `
        <h2><strong>Beneficios</strong></h2>
        <ul><li>Controlá tu actividad diaria desde el celular.</li><li>Usala todo el día sin molestias.</li></ul>
        <h2>Características</h2>
        <ul><li>Pulsera inteligente sin pantalla.</li><li>Compatible con app móvil.</li></ul>
        <h2>Opciones de envío y pago</h2>
        <p>Asunción: envío gratis con pago anticipado.</p>
      `,
    });

    expect(contenido.descripcion).toBe('Controlá tu actividad diaria desde el celular. Usala todo el día sin molestias. Pulsera inteligente sin pantalla. Compatible con app móvil.');
    expect(contenido.descripcion).not.toContain('Opciones de envío');
  });
});
