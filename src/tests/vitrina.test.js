const PrecioUsuarioService = require('../services/precioUsuario.service');
const { sequelize, Categoria, Producto, ProductoCombo, ProductoImagen, PrecioUsuario, Marca, Proveedor, ComboConfiguracion, Usuario } = require('../models');
const { Op } = require('sequelize');

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
    findOrCreate: jest.fn(),
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
  Usuario: {
    findAll: jest.fn(),
  },
  Rol: {},
}));

describe('PrecioUsuarioService.listarCatalogoPaginado', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    PrecioUsuario.findAll.mockResolvedValue([]);
    PrecioUsuario.findOrCreate.mockResolvedValue([{ precio: '120000', save: jest.fn() }]);
    Usuario.findAll.mockResolvedValue([{ id: 1 }]);
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

  test('en modo usuario, todos incluye solo productos globales/admin y propios', async () => {
    sequelize.query
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const resultado = await PrecioUsuarioService.listarCatalogoPaginado(42, 1, {});

    expect(sequelize.query).toHaveBeenCalled();
    const countSql = sequelize.query.mock.calls[0][0];
    const dataSql = sequelize.query.mock.calls[1][0];

    expect(countSql).toContain('p.creado_por IS NULL');
    expect(countSql).toContain('p.creado_por = :usuario_id');
    expect(countSql).toContain("r.nombre = 'administrador'");
    expect(dataSql).toContain('p.creado_por IS NULL');
    expect(dataSql).toContain('p.creado_por = :usuario_id');
    expect(dataSql).toContain("r.nombre = 'administrador'");
    expect(resultado.total).toBe(0);
  });

  test('en modo administrador, todos no restringe por creador', async () => {
    sequelize.query
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const resultado = await PrecioUsuarioService.listarCatalogoPaginado(42, 1, {}, true);

    expect(sequelize.query).toHaveBeenCalled();
    const dataSql = sequelize.query.mock.calls[1][0];

    expect(dataSql).not.toContain('p.creado_por = :usuario_id');
    expect(dataSql).not.toContain('p.creado_por IS NULL');
    expect(resultado.total).toBe(0);
  });

  test('guardar precio de producto exige producto global/admin o propio para usuarios normales', async () => {
    Producto.findOne.mockResolvedValueOnce({
      id: 10,
      precio_minimo: null,
    });

    await PrecioUsuarioService.guardarPrecioProducto(42, 1, 10, 120000);

    const [{ where }] = Producto.findOne.mock.calls[0];
    expect(where).toMatchObject({ id: 10, inquilino_id: 1, activo: true });
    expect(where[Op.or]).toEqual([
      { creado_por: null },
      { creado_por: { [Op.in]: [42, 1] } },
    ]);
    expect(PrecioUsuario.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
      where: { usuario_id: 42, tipo: 'producto', referencia_id: 10 },
    }));
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
