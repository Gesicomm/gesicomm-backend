jest.mock('../models', () => ({
  sequelize: {
    transaction: jest.fn(),
    where: jest.fn((...args) => args),
    fn: jest.fn((...args) => args),
    col: jest.fn((value) => value),
  },
  Categoria: { findOne: jest.fn(), create: jest.fn() },
  Producto: { findAll: jest.fn() },
  ProductoImagen: { bulkCreate: jest.fn() },
  Deposito: { findAll: jest.fn() },
}));
jest.mock('../services/producto.service', () => ({ crear: jest.fn(), sincronizarStockDeposito: jest.fn() }));
jest.mock('../services/productoVariante.service', () => ({}));

const ExcelJS = require('exceljs');
const { sequelize, Categoria, Producto, ProductoImagen, Deposito } = require('../models');
const ProductoService = require('../services/producto.service');
const {
  importarMasivo, generarPlantilla, leerLibro, armarProductos, COLUMNAS_PRODUCTOS,
} = require('../services/productoImportacionMasiva.service');

const contexto = { inquilinoId: 2, usuarioId: 9, esAdmin: false, tiendaId: 4 };
const completo = {
  sku: 'MOUSE-1', nombre: 'Mouse inalámbrico', costo: 35000, precio: 89000,
  descripcion: 'Mouse con receptor USB. Ideal para la oficina.',
  imagenes: 'https://cdn.test/1.jpg\nhttps://cdn.test/2.jpg', stock: 20,
  propuesta_valor: 'Trabajá sin cables.', beneficios: 'Batería larga | Clic silencioso',
  categoria: 'Tecnología', precio_ancla: '116.000',
};

/** La plantilla real, completada como lo haría la persona. */
async function archivo(productos = []) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await generarPlantilla());
  productos.forEach((fila) => libro.getWorksheet('Productos').addRow(COLUMNAS_PRODUCTOS.map((c) => fila[c.clave] ?? '')));
  return { originalname: 'plantilla-productos-gesicom.xlsx', buffer: await libro.xlsx.writeBuffer() };
}
const erroresDe = (resultado) => resultado.errores.map((e) => `${e.fila} ${e.sku}: ${e.error}`);

beforeEach(() => {
  jest.clearAllMocks();
  sequelize.transaction.mockResolvedValue({ commit: jest.fn(), rollback: jest.fn() });
  Producto.findAll.mockResolvedValue([]);
  Deposito.findAll.mockResolvedValue([{ id: 7, nombre: 'Depósito Central' }]);
  Categoria.findOne.mockResolvedValue({ id: 5 });
  ProductoService.crear.mockImplementation(async (datos) => ({ id: 100, ...datos }));
});

describe('Carga masiva de productos con la plantilla de Gesicom', () => {
  test('la plantilla trae solo lo básico, con lo obligatorio marcado, y vacía no importa nada', async () => {
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(await generarPlantilla());
    expect(libro.worksheets.map((h) => h.name)).toEqual(['Productos', 'Instrucciones']);
    expect(libro.getWorksheet('Productos').getRow(1).values.slice(1)).toEqual([
      'SKU *', 'Nombre *', 'Imágenes (links) *', 'Costo de compra *', 'Precio de venta *', 'Stock *', 'Descripción *',
      'Ubicación del stock', 'Categoría', 'Propuesta de valor', 'Beneficios', 'Precio ancla',
    ]);

    await expect(importarMasivo(await archivo(), contexto)).rejects.toThrow('La hoja Productos está vacía');
  });

  test('la vista previa marca cada fila con error y no escribe nada', async () => {
    Producto.findAll.mockResolvedValue([{ sku: 'ya-existe', nombre: 'Auricular' }]);
    const resultado = await importarMasivo(await archivo([
      completo,
      { ...completo, sku: 'mouse-1' },
      { ...completo, sku: 'YA-EXISTE' },
      { sku: 'SIN-DATOS', nombre: '', precio: 'gratis', descripcion: '', imagenes: 'foto.jpg' },
      { ...completo, sku: 'ANCLA-BAJA', precio_ancla: 50000 },
      { ...completo, sku: 'BAJO-COSTO', costo: 90000 },
      { ...completo, sku: 'STOCK-MAL', stock: '2,5' },
    ]), contexto);

    expect(resultado).toMatchObject({ aplicado: false, total_leidos: 7, listos: 1, creados: 0 });
    expect(erroresDe(resultado)).toEqual([
      '3 mouse-1: El SKU "mouse-1" está repetido en el archivo (fila 2).',
      '4 YA-EXISTE: El SKU "YA-EXISTE" ya existe en tu catálogo ("Auricular").',
      '5 SIN-DATOS: Falta el nombre.',
      '5 SIN-DATOS: El precio de venta "gratis" no es un número mayor a cero.',
      '5 SIN-DATOS: Falta la descripción.',
      '5 SIN-DATOS: Este link de imagen no es válido: foto.jpg. Tiene que empezar con http:// o https://',
      '5 SIN-DATOS: Falta el costo de compra.',
      '5 SIN-DATOS: Falta el stock (poné 0 si todavía no tenés unidades).',
      '6 ANCLA-BAJA: El precio ancla tiene que ser mayor al precio de venta.',
      '7 BAJO-COSTO: El precio de venta es menor al costo de compra.',
      '8 STOCK-MAL: El stock "2,5" no es un número entero.',
    ]);
    expect(ProductoService.crear).not.toHaveBeenCalled();
    expect(ProductoImagen.bulkCreate).not.toHaveBeenCalled();
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  test('al aplicar crea el producto con costo, precio, imágenes por link y el stock asentado en su ubicación', async () => {
    const resultado = await importarMasivo(await archivo([completo, { ...completo, sku: 'SIN-STOCK', stock: 0, categoria: '' }]), contexto, { aplicar: true });

    expect(resultado).toMatchObject({ aplicado: true, total_leidos: 2, listos: 2, creados: 2, imagenes: 4, errores_total: 0 });
    const [datos, inquilinoId, usuarioId, esAdmin, , tiendaId] = ProductoService.crear.mock.calls[0];
    expect([inquilinoId, usuarioId, esAdmin, tiendaId]).toEqual([2, 9, false, 4]);
    expect(datos).toMatchObject({
      sku: 'MOUSE-1', nombre: 'Mouse inalámbrico', categoria_id: 5,
      precio_costo: 35000, precio_base: 89000, precio_ancla: 116000,
      descripcion_larga: 'Mouse con receptor USB. Ideal para la oficina.',
      descripcion_corta: 'Mouse con receptor USB.',
      propuesta_valor: 'Trabajá sin cables.',
      stock_salon: 20, stock_deposito: 0, estado_venta: 'en_venta',
      beneficios: [{ titulo: 'Batería larga', texto: '', icono: 'check' }, { titulo: 'Clic silencioso', texto: '', icono: 'check' }],
    });
    expect(ProductoService.sincronizarStockDeposito.mock.calls.map((c) => c.slice(0, 3))).toEqual([
      [100, 9, [{ deposito_id: 7, variante_id: null, cantidad: 20 }]],
      [100, 9, []],
    ]);
    expect(ProductoService.crear.mock.calls[1][0]).toMatchObject({ sku: 'SIN-STOCK', stock_salon: 0, categoria_id: null });
    expect(ProductoImagen.bulkCreate.mock.calls[0][0]).toEqual([
      expect.objectContaining({ producto_id: 100, url: 'https://cdn.test/1.jpg', es_principal: true, orden: 0 }),
      expect.objectContaining({ producto_id: 100, url: 'https://cdn.test/2.jpg', es_principal: false, orden: 1 }),
    ]);
  });

  test('el stock necesita una ubicación: usa la única, la que dice la fila, o explica qué falta', async () => {
    const filas = [
      completo,
      { ...completo, sku: 'EN-LOCAL', ubicacion: 'local centro' },
      { ...completo, sku: 'NO-EXISTE', ubicacion: 'Galpón' },
      { ...completo, sku: 'SIN-STOCK', stock: 0 },
    ];
    Deposito.findAll.mockResolvedValue([{ id: 7, nombre: 'Depósito Central' }, { id: 8, nombre: 'Local Centro' }]);
    const varias = await importarMasivo(await archivo(filas), contexto, { aplicar: true });
    expect(Deposito.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { usuario_id: 9, activo: true } }));
    expect(varias).toMatchObject({ listos: 2, creados: 2, productos: [{ sku: 'EN-LOCAL' }, { sku: 'SIN-STOCK' }] });
    expect(ProductoService.sincronizarStockDeposito.mock.calls[0][2]).toEqual([{ deposito_id: 8, variante_id: null, cantidad: 20 }]);
    expect(erroresDe(varias)).toEqual([
      '2 MOUSE-1: Tenés varias ubicaciones: escribí en "Ubicación del stock" una de estas: Depósito Central, Local Centro.',
      '4 NO-EXISTE: La ubicación "Galpón" no existe. Tus ubicaciones: Depósito Central, Local Centro.',
    ]);

    Deposito.findAll.mockResolvedValue([]);
    const ninguna = await importarMasivo(await archivo([completo, { ...completo, sku: 'SIN-STOCK', stock: 0 }]), contexto);
    expect(ninguna).toMatchObject({ listos: 1 });
    expect(erroresDe(ninguna)).toEqual(['2 MOUSE-1: Para cargar stock primero creá una ubicación en Mi Tienda → Depósitos (o dejá el stock en 0).']);
  });

  test('un producto que falla al crearse no frena a los demás', async () => {
    ProductoService.crear.mockRejectedValueOnce(new Error('El SKU "MOUSE-1" ya está usado en el producto "Otro".'));
    const resultado = await importarMasivo(await archivo([completo, { ...completo, sku: 'MOUSE-2' }]), contexto, { aplicar: true });

    expect(resultado).toMatchObject({ listos: 2, creados: 1, productos: [{ sku: 'MOUSE-2' }] });
    expect(resultado.errores).toEqual([{ hoja: 'Productos', fila: 2, sku: 'MOUSE-1', error: 'El SKU "MOUSE-1" ya está usado en el producto "Otro".' }]);
  });

  test('rechaza un archivo sin las columnas obligatorias y pide una tienda a quien no es admin', async () => {
    const libro = new ExcelJS.Workbook();
    libro.addWorksheet('Hoja1').addRows([['Nombre', 'Precio de venta'], ['Mouse', 1000]]);
    const ajeno = { originalname: 'lista.xlsx', buffer: await libro.xlsx.writeBuffer() };
    await expect(leerLibro(ajeno)).rejects.toThrow('le faltan columnas obligatorias: SKU, Imágenes (links), Costo de compra, Stock, Descripción');
    await expect(leerLibro({ originalname: 'productos.csv', buffer: Buffer.from('a,b') })).rejects.toThrow('formato Excel (.xlsx)');
    await expect(importarMasivo(ajeno, { ...contexto, tiendaId: null })).rejects.toThrow('Seleccioná una tienda');
    expect(() => armarProductos({ productos: Array.from({ length: 501 }, (_, i) => ({ __fila: i + 2 })) }))
      .toThrow('Subí hasta 500 por archivo');
  });
});
