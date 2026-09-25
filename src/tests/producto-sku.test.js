jest.mock('../models', () => ({
  sequelize: {
    col: jest.fn((v) => v),
    fn: jest.fn((...a) => a),
    where: jest.fn((...a) => a),
  },
  Producto: { findOne: jest.fn(), create: jest.fn() },
  HistorialPrecio: {},
  ProductoVariante: {},
  Oferta: {},
  OfertaComponente: {},
  ProductoFaq: {},
  PrecioUsuario: {},
}));

const ProductoService = require('../services/producto.service');
const { Producto } = require('../models');

describe('SKU obligatorio', () => {
  beforeEach(() => jest.clearAllMocks());

  test('alta sin SKU se rechaza y no crea nada', async () => {
    await expect(ProductoService.crear({ nombre: 'X', precio_base: 1000, sku: '  ' }, 1, 9, false))
      .rejects.toThrow('El SKU es obligatorio.');
    expect(Producto.create).not.toHaveBeenCalled();
  });

  test('SKU repetido (sin distinguir mayúsculas) se rechaza', async () => {
    Producto.findOne.mockResolvedValueOnce({ id: 5, nombre: 'Air Fryer' });
    await expect(ProductoService.validarSku('ws-1', 1)).rejects.toThrow(/ya está usado en el producto "Air Fryer"/);
  });

  test('guarda el SKU sin espacios', async () => {
    Producto.findOne.mockResolvedValueOnce(null);
    await expect(ProductoService.validarSku('  WS-1 ', 1)).resolves.toBe('WS-1');
  });

  describe('edición', () => {
    const producto = (sku) => ({
      id: 7, sku, creado_por: 9, precio_base: '1000', descuento_porcentaje: '0', precio_minimo: null,
      save: jest.fn(),
    });

    test('no se puede borrar un SKU existente', async () => {
      Producto.findOne.mockResolvedValueOnce(producto('WS-1'));
      await expect(ProductoService.actualizar(7, { sku: '' }, 1, 9, false))
        .rejects.toThrow('El SKU es obligatorio.');
    });

    test('un producto viejo sin SKU se puede editar sin cargarlo', async () => {
      const p = producto(null);
      Producto.findOne.mockResolvedValueOnce(p);
      jest.spyOn(ProductoService, 'serializar').mockReturnValue({});
      await ProductoService.actualizar(7, { sku: '', nombre: undefined }, 1, 9, false);
      expect(p.sku).toBeNull();
      expect(p.save).toHaveBeenCalled();
    });
  });
});
