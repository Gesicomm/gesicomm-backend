const { Op } = require('sequelize');
const ProductoService = require('../services/producto.service');
const { Producto, ProductoVariante, Oferta, Usuario } = require('../models');

jest.mock('../models', () => ({
  sequelize: {
    col: jest.fn((value) => value),
  },
  Producto: {
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
  },
  HistorialPrecio: {},
  ProductoVariante: {
    findAll: jest.fn(),
  },
  Oferta: {
    findAll: jest.fn(),
  },
  OfertaComponente: {},
  ProductoFaq: {},
  Usuario: {
    findAll: jest.fn(),
  },
  Rol: {},
}));

describe('ProductoService visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Producto.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    ProductoVariante.findAll.mockResolvedValue([]);
    Oferta.findAll.mockResolvedValue([]);
    Usuario.findAll.mockResolvedValue([{ id: 1 }]);
  });

  test('un usuario normal solo busca productos globales/admin y propios', async () => {
    await ProductoService.buscar({}, 1, false, 42);

    const [{ where }] = Producto.findAndCountAll.mock.calls[0];
    expect(where.inquilino_id).toBe(1);
    expect(where[Op.and]).toEqual([
      {
        [Op.or]: [
          { creado_por: null },
          { creado_por: { [Op.in]: [42, 1] } },
        ],
      },
    ]);
  });

  test('un usuario normal no puede forzar creado_por de otro usuario', async () => {
    await ProductoService.buscar({ creado_por: 99 }, 1, false, 42);

    const [{ where }] = Producto.findAndCountAll.mock.calls[0];
    expect(where.creado_por).toBe(42);
    expect(where[Op.and]).toBeUndefined();
  });

  test('detalle de usuario normal queda limitado a global/admin o propio', async () => {
    Producto.findOne.mockResolvedValueOnce(null);

    await expect(ProductoService.detalle(10, 1, false, 42)).rejects.toThrow('Producto no encontrado.');

    const [{ where }] = Producto.findOne.mock.calls[0];
    expect(where).toMatchObject({ id: 10, inquilino_id: 1 });
    expect(where[Op.or]).toEqual([
      { creado_por: null },
      { creado_por: { [Op.in]: [42, 1] } },
    ]);
  });

  test('admin puede buscar sin restriccion por creador', async () => {
    await ProductoService.buscar({}, 1, true, 7);

    const [{ where }] = Producto.findAndCountAll.mock.calls[0];
    expect(where[Op.and]).toBeUndefined();
    expect(where.creado_por).toBeUndefined();
  });
});
