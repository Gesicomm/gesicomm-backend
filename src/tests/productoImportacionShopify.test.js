/**
 * productoImportacionShopify.service — el import de Shopify tiene que
 * resolver la columna "Vendor" a un Proveedor real (FK), no solo guardarla
 * como texto suelto en ficha_datos: si no, el filtro por Proveedor de Mi
 * Catálogo nunca encuentra los productos que Shopify sí trae con proveedor.
 */

jest.mock('../models', () => {
  const transaction = { commit: jest.fn(), rollback: jest.fn() };
  return {
    sequelize: {
      transaction: jest.fn(async () => transaction),
      where: jest.fn(),
      fn: jest.fn(),
      col: jest.fn(),
    },
    Categoria: { findOne: jest.fn(async () => null), create: jest.fn(async () => ({ id: 5 })) },
    Producto: { findOne: jest.fn(async () => null) },
    ProductoImagen: { bulkCreate: jest.fn(async () => []) },
    ProductoFaq: { bulkCreate: jest.fn(async () => []) },
    Proveedor: { findOne: jest.fn(), create: jest.fn() },
    __transaction: transaction,
  };
});

jest.mock('../services/producto.service', () => ({
  crear: jest.fn(async () => ({ id: 99 })),
  recalcularStockPadre: jest.fn(async () => null),
}));

jest.mock('../services/productoVariante.service', () => ({
  crearMultiples: jest.fn(async () => null),
}));

const { Proveedor } = require('../models');
const ProductoService = require('../services/producto.service');
const ImportacionShopifyService = require('../services/productoImportacionShopify.service');

const CONTEXTO = { inquilinoId: 1, usuarioId: 7, esAdmin: false, tiendaId: 3 };

function archivoCsv(filas) {
  const encabezados = ['Handle', 'Title', 'Vendor', 'Variant SKU', 'Variant Price', 'Variant Inventory Qty', 'Tags'];
  const lineas = [encabezados.join(','), ...filas.map((f) => encabezados.map((h) => f[h] ?? '').join(','))];
  return { originalname: 'raha.csv', buffer: Buffer.from(lineas.join('\n'), 'utf8') };
}

describe('importarShopify — proveedor desde la columna Vendor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('crea el Proveedor si no existe y lo asigna al producto', async () => {
    Proveedor.findOne.mockResolvedValue(null);
    Proveedor.create.mockResolvedValue({ id: 42, nombre: 'RAHA' });

    const archivo = archivoCsv([
      { Handle: 'mouse-raha', Title: 'Mouse Raha', Vendor: 'RAHA', 'Variant SKU': 'MOUSE-1', 'Variant Price': '89000', 'Variant Inventory Qty': '10' },
    ]);

    const resultado = await ImportacionShopifyService.importarShopify(archivo, CONTEXTO);

    expect(resultado.creados).toBe(1);
    expect(Proveedor.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: { usuario_id: CONTEXTO.usuarioId, nombre: expect.anything() },
    }));
    expect(Proveedor.create).toHaveBeenCalledWith({ usuario_id: CONTEXTO.usuarioId, nombre: 'RAHA' }, expect.anything());
    expect(ProductoService.crear).toHaveBeenCalledWith(
      expect.objectContaining({ proveedor_id: 42 }),
      CONTEXTO.inquilinoId, CONTEXTO.usuarioId, CONTEXTO.esAdmin, expect.anything(), CONTEXTO.tiendaId,
    );
  });

  test('reutiliza el Proveedor existente en vez de duplicarlo', async () => {
    Proveedor.findOne.mockResolvedValue({ id: 42, nombre: 'RAHA' });

    const archivo = archivoCsv([
      { Handle: 'mouse-raha', Title: 'Mouse Raha', Vendor: 'RAHA', 'Variant SKU': 'MOUSE-1', 'Variant Price': '89000', 'Variant Inventory Qty': '10' },
    ]);

    await ImportacionShopifyService.importarShopify(archivo, CONTEXTO);

    expect(Proveedor.create).not.toHaveBeenCalled();
    expect(ProductoService.crear).toHaveBeenCalledWith(
      expect.objectContaining({ proveedor_id: 42 }),
      expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    );
  });

  test('sin Vendor no crea proveedor y el producto queda sin proveedor_id', async () => {
    const archivo = archivoCsv([
      { Handle: 'mouse-generico', Title: 'Mouse Genérico', Vendor: '', 'Variant SKU': 'MOUSE-2', 'Variant Price': '50000', 'Variant Inventory Qty': '5' },
    ]);

    await ImportacionShopifyService.importarShopify(archivo, CONTEXTO);

    expect(Proveedor.findOne).not.toHaveBeenCalled();
    expect(Proveedor.create).not.toHaveBeenCalled();
    expect(ProductoService.crear).toHaveBeenCalledWith(
      expect.objectContaining({ proveedor_id: null }),
      expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    );
  });
});
