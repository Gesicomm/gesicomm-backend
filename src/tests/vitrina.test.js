const PrecioUsuarioService = require('../services/precioUsuario.service');
const { sequelize, Categoria, Producto, ProductoCombo, ProductoImagen, PrecioUsuario, Marca, Proveedor, ComboConfiguracion } = require('../models');

jest.mock('../models', () => ({
  sequelize: {
    query: jest.fn(),
    QueryTypes: { SELECT: 'SELECT' },
  },
  Categoria: {
    findOne: jest.fn(),
  },
  Producto: {
    findAll: jest.fn(),
    findOne: jest.fn(),
  },
  ProductoCombo: {
    findAll: jest.fn(),
    findOne: jest.fn(),
  },
  ProductoImagen: {
    findAll: jest.fn(),
  },
  PrecioUsuario: {
    findAll: jest.fn(),
    findOne: jest.fn(),
  },
  Marca: {
    findAll: jest.fn(),
  },
  Proveedor: {
    findAll: jest.fn(),
  },
  ComboConfiguracion: {
    findOrCreate: jest.fn().mockResolvedValue([{
      inquilino_id: 1,
      cpa_porcentaje: 0,
      costo_envio: 0,
      costo_empaque: 0,
      costo_confirmacion: 0,
      margen_minimo: 10,
      escenarios_descuento: [0, 5, 10],
    }]),
  },
}));

describe('PrecioUsuarioService.listarCatalogoPaginado', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    PrecioUsuario.findAll.mockResolvedValue([]);
  });

  test('incluye filtro p.creado_por = :usuario_id en la consulta SQL cuando solamenteMios es true', async () => {
    sequelize.query
      .mockResolvedValueOnce([{ total: 1 }]) // countQuery
      .mockResolvedValueOnce([{ id: 10, tipo: 'producto', nombre: 'Mi Producto', precio_efectivo: 100000 }]) // dataQuery
      .mockResolvedValueOnce([]) // categoriasUnicas
      .mockResolvedValueOnce([]); // proveedoresUnicos

    Producto.findAll.mockResolvedValueOnce([
      {
        id: 10,
        nombre: 'Mi Producto',
        precio_base: '100000',
        precio_minimo: '80000',
        cantidad_disponible: 5,
        categoria: { id: 1, nombre: 'Electrónica' },
        Marca: null,
        proveedor: null,
        creado_por: 42,
      },
    ]);
    ProductoImagen.findAll.mockResolvedValueOnce([]);

    const resultado = await PrecioUsuarioService.listarCatalogoPaginado(42, 1, { solamenteMios: true });

    expect(sequelize.query).toHaveBeenCalled();
    const countSql = sequelize.query.mock.calls[0][0];
    const dataSql = sequelize.query.mock.calls[1][0];

    expect(countSql).toContain('p.creado_por = :usuario_id');
    expect(dataSql).toContain('p.creado_por = :usuario_id');
    expect(resultado.total).toBe(1);
    expect(resultado.items).toHaveLength(1);
    expect(resultado.items[0].nombre).toBe('Mi Producto');
    expect(resultado.items[0].creado_por).toBe(42);
  });

  test('no incluye filtro p.creado_por cuando solamenteMios es false o no se especifica', async () => {
    sequelize.query
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const resultado = await PrecioUsuarioService.listarCatalogoPaginado(42, 1, {});

    expect(sequelize.query).toHaveBeenCalled();
    const dataSql = sequelize.query.mock.calls[1][0];

    expect(dataSql).not.toContain('p.creado_por = :usuario_id');
    expect(resultado.total).toBe(0);
  });
});

describe('PrecioUsuarioService.analizarSensibilidadProducto', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('utiliza precio_costo en el análisis de sensibilidad cuando está presente', async () => {
    Producto.findOne.mockResolvedValueOnce({
      id: 10,
      nombre: 'Lentes Amarillos',
      precio_base: '220000',
      precio_costo: '30000',
      precio_minimo: null,
    });
    PrecioUsuario.findOne.mockResolvedValueOnce(null);

    const resultado = await PrecioUsuarioService.analizarSensibilidadProducto(42, 1, 10);

    expect(resultado.producto.precio_efectivo).toBe(220000);
    expect(resultado.profit).toBe(190000); // 220.000 - 30.000 = 190.000
    expect(resultado.margin).toBeGreaterThan(0.5); // 86.36% margin
  });
});
