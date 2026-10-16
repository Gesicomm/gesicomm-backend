jest.mock('../models', () => ({
  sequelize: {
    transaction: jest.fn(async (cb) => cb({})),
  },
  Producto: {},
  HistorialPrecio: {},
  ProductoVariante: {},
  Oferta: {},
  OfertaComponente: {},
  ProductoFaq: {},
  PrecioUsuario: {},
}));

const ProductoService = require('../services/producto.service');

describe('ProductoService.descuentoMasivo — descuento real con vigencia', () => {
  beforeEach(() => jest.clearAllMocks());

  test('aplica el porcentaje y la fecha de fin a cada producto', async () => {
    jest.spyOn(ProductoService, 'actualizar').mockResolvedValue({});
    const finAt = '2026-12-31T23:59:00.000Z';

    const resultado = await ProductoService.descuentoMasivo([1, 2, 2], { pct: 30, finAt }, 1, 9, false, 5);

    expect(resultado.actualizados).toEqual([1, 2]); // dedupe de ids repetidos
    expect(resultado.omitidos).toEqual([]);
    expect(ProductoService.actualizar).toHaveBeenCalledTimes(2);
    expect(ProductoService.actualizar).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ descuento_porcentaje: 30, descuento_fin: finAt }),
      1, 9, false, {}, 5,
    );
    // descuento_inicio = ahora, no lo manda el caller
    const campos = ProductoService.actualizar.mock.calls[0][1];
    expect(campos.descuento_inicio).toBeTruthy();
  });

  test('pct null quita el descuento (0, sin fechas) en vez de aplicarlo', async () => {
    jest.spyOn(ProductoService, 'actualizar').mockResolvedValue({});

    await ProductoService.descuentoMasivo([1], { pct: null, finAt: null }, 1, 9, false, 5);

    expect(ProductoService.actualizar).toHaveBeenCalledWith(
      1,
      { descuento_porcentaje: 0, descuento_inicio: null, descuento_fin: null },
      1, 9, false, {}, 5,
    );
  });

  test('un producto que no es de este comercio se omite, no tira toda la operación', async () => {
    jest.spyOn(ProductoService, 'actualizar')
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Producto no encontrado.'));

    const resultado = await ProductoService.descuentoMasivo([1, 2], { pct: 20, finAt: '2026-12-31' }, 1, 9, false, 5);

    expect(resultado.actualizados).toEqual([1]);
    expect(resultado.omitidos).toEqual([{ id: 2, motivo: 'Producto no encontrado.' }]);
  });

  test('sin ids no hace nada', async () => {
    await expect(ProductoService.descuentoMasivo([], { pct: 20, finAt: '2026-12-31' }, 1, 9, false, 5))
      .rejects.toThrow('Seleccioná al menos un producto.');
  });
});
