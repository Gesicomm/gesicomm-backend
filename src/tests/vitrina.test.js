const PrecioUsuarioService = require('../services/precioUsuario.service');
const { sequelize, Categoria, Producto, ProductoCombo, ProductoImagen, PrecioUsuario, Marca, Proveedor, ComboConfiguracion, Usuario, Landing, LandingItem } = require('../models');
const { Op } = require('sequelize');

jest.mock('../models', () => ({
  sequelize: {
    query: jest.fn(),
    literal: jest.fn(sql => sql),
    QueryTypes: { SELECT: 'SELECT' },
  },
  Categoria: {
    findOne: jest.fn(),
    findAll: jest.fn(),
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
  ProductoVariante: { findAll: jest.fn().mockResolvedValue([]) },
  Oferta: { findAll: jest.fn().mockResolvedValue([]) },
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
  Landing: {
    findOne: jest.fn(),
  },
  LandingItem: {
    destroy: jest.fn(),
  },
  Rol: {},
}));

describe('PrecioUsuarioService.listarCatalogoPaginado', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    PrecioUsuario.findAll.mockResolvedValue([]);
    PrecioUsuario.findOrCreate.mockResolvedValue([{ precio: '120000', save: jest.fn() }]);
    Usuario.findAll.mockResolvedValue([{ id: 1 }]);
    Landing.findOne.mockReset();
    LandingItem.destroy.mockReset();
  });

  test('las páginas grandes conservan la portada sin hidratar productos ni galerías', async () => {
    sequelize.query.mockResolvedValueOnce([{ total: 3 }]).mockResolvedValueOnce([
      { id: 10, tipo: 'producto', nombre: 'Producto', precio_efectivo: '100000', imagen: 'https://cdn.test/producto.webp' },
      { id: 20, tipo: 'combo', nombre: 'Combo', precio_efectivo: '200000', imagen: 'https://cdn.test/combo.webp' },
      { id: 30, tipo: 'producto', nombre: 'Sin foto', precio_efectivo: '50000' },
    ]);

    const resultado = await PrecioUsuarioService.listarCatalogoPaginado(42, 1, { limit: 10000 }, false, 69);

    expect(resultado.items.map(i => i.imagen)).toEqual(['https://cdn.test/producto.webp', 'https://cdn.test/combo.webp', null]);
    expect(Producto.findAll).not.toHaveBeenCalled();
    expect(ProductoImagen.findAll).not.toHaveBeenCalled();
    const sql = sequelize.query.mock.calls[1][0];
    expect(sql).toContain('pi.producto_id = p.id AND pi.inquilino_id = :inquilino_id');
    expect(sql).toContain('ci.combo_id = c.id AND ci.inquilino_id = :inquilino_id');
    expect(sql).toContain('COALESCE(');
    expect(sequelize.query.mock.calls[1][1].replacements.tienda_id).toBe(69);
  });

  test('el catálogo del editor conserva el identificador público y la categoría en páginas grandes', async () => {
    sequelize.query.mockResolvedValueOnce([{ total: 3630 }]).mockResolvedValueOnce([
      { id: 10, tipo: 'producto', slug: 'abridor-de-vino', nombre: 'Abridor', categoria_id: 8, categoria: 'Cocina', precio_efectivo: '100000' },
      { id: 20, tipo: 'combo', slug: null, nombre: 'Pack', categoria_id: 8, categoria: 'Cocina', precio_efectivo: '200000' },
    ]);

    const resultado = await PrecioUsuarioService.listarCatalogoPaginado(42, 1, { limit: 10000 }, false, 69);

    // El selector de 10 usa el slug y las reglas por categoría usan el nombre.
    // Ambos deben coincidir con el catálogo completo que carga el editor.
    expect(resultado.items[0]).toMatchObject({ slug: 'abridor-de-vino', categoria_id: 8, categoria: 'Cocina' });
    expect(resultado.items[1]).toMatchObject({ slug: null, categoria_id: 8, categoria: 'Cocina' });
    const sql = sequelize.query.mock.calls[1][0];
    expect(sql).toContain('p.slug');
    expect(sql).toContain('NULL::text AS slug');
    expect(sql).toContain('cat.nombre');
    expect(sql).toContain('cat.id = COALESCE(pu.categoria_id, p.categoria_id)');
    expect(sql).toContain('cat.inquilino_id = :inquilino_id');
    expect(Producto.findAll).not.toHaveBeenCalled();
    expect(ProductoCombo.findAll).not.toHaveBeenCalled();
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

  test('reutiliza el precio y la categoría del JOIN sin consultar precios de la página otra vez', async () => {
    sequelize.query.mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{ id: 10, tipo: 'producto', precio_usuario: '140000', categoria_personalizada_id: 8 }])
      .mockResolvedValue([]);
    Producto.findAll.mockResolvedValueOnce([{ id: 10, nombre: 'Producto', precio_base: '100000', precio_minimo: null, creado_por: 42 }]);
    Categoria.findAll.mockResolvedValueOnce([{ id: 8, nombre: 'Personalizada' }]);
    ProductoImagen.findAll.mockResolvedValueOnce([]);
    const data = await PrecioUsuarioService.listarCatalogoPaginado(42, 1);
    expect(data.items[0]).toMatchObject({ precio_usuario: 140000, precio_efectivo: 140000, categoria: 'Personalizada', categoria_id: 8 });
    expect(PrecioUsuario.findAll).not.toHaveBeenCalled();
  });

  test('acota la paginación y desempata productos con nombres repetidos', async () => {
    sequelize.query.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValue([]);
    const data = await PrecioUsuarioService.listarCatalogoPaginado(42, 1, { page: -2, limit: 20000 });
    expect(data.page).toBe(1);
    expect(sequelize.query.mock.calls[1][1].replacements).toMatchObject({ limit: 10000, offset: 0 });
    expect(sequelize.query.mock.calls[1][0]).toContain('ORDER BY nombre ASC, tipo ASC, id ASC');
  });

  test('"seleccionar todo" (limit grande) se salta el enriquecimiento pesado — ver OOM del 2026-10-16', async () => {
    sequelize.query
      .mockResolvedValueOnce([{ total: 3630 }]) // countQuery
      .mockResolvedValueOnce(Array.from({ length: 3630 }, (_, i) => ({
        id: i + 1, tipo: 'producto', nombre: `Producto ${i + 1}`, creado_por: 42, precio_efectivo: '1000',
      }))); // dataQuery

    const resultado = await PrecioUsuarioService.listarCatalogoPaginado(42, 1, { limit: 3630 });

    expect(resultado.total).toBe(3630);
    expect(resultado.items).toHaveLength(3630);
    expect(resultado.items[0]).toEqual({ id: 1, tipo: 'producto', slug: null, nombre: 'Producto 1', categoria_id: null, categoria: null, creado_por: 42, precio_efectivo: 1000, imagen: null });
    // Nada de Sequelize con includes anidados (categoría/marca/proveedor/imágenes/combos) para esta selección masiva.
    expect(Producto.findAll).not.toHaveBeenCalled();
    expect(ProductoCombo.findAll).not.toHaveBeenCalled();
    expect(ProductoImagen.findAll).not.toHaveBeenCalled();
  });

  test('liviano: true fuerza el modo liviano aunque el limit sea chico', async () => {
    sequelize.query
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{ id: 10, tipo: 'producto', nombre: 'X', creado_por: null, precio_efectivo: '500' }]);

    const resultado = await PrecioUsuarioService.listarCatalogoPaginado(42, 1, { limit: 10, liviano: true });

    expect(resultado.items).toEqual([{ id: 10, tipo: 'producto', slug: null, nombre: 'X', categoria_id: null, categoria: null, creado_por: null, precio_efectivo: 500, imagen: null }]);
    expect(Producto.findAll).not.toHaveBeenCalled();
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

  test.each([false, true])('Mis combos conserva un combo propio cuyo principal es del administrador (admin=%s)', async (esAdmin) => {
    sequelize.query
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{ id: 50, tipo: 'combo' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    ProductoCombo.findAll.mockImplementationOnce(async ({ include }) => {
      const padreWhere = include.find(i => i.as === 'producto_padre').where;
      // Reproduce el INNER JOIN: un filtro del dueño del combo aplicado al
      // principal de Gesicom elimina el combo aunque el conteo SQL lo incluya.
      if (padreWhere.creado_por === 42) return [];
      return [{
        id: 50, nombre: 'Mi combo', creado_por: 42, precio_total: '190000', precio_minimo: null,
        producto_padre: { id: 10, nombre: 'Principal Gesicom', creado_por: 1, precio_base: '100000' },
        items: [], imagenes: [],
      }];
    });
    ProductoImagen.findAll.mockResolvedValueOnce([]);

    const resultado = await PrecioUsuarioService.listarCatalogoPaginado(42, 1, { tipo: 'combo', solamenteMios: true }, esAdmin);

    expect(resultado.total).toBe(1);
    expect(resultado.items).toEqual([expect.objectContaining({ id: 50, creado_por: 42, origen_catalogo: 'PROPIO' })]);
    const consulta = ProductoCombo.findAll.mock.calls.at(-1)[0];
    expect(consulta.where).toMatchObject({ inquilino_id: 1, creado_por: 42 });
    const padreWhere = consulta.include.find(i => i.as === 'producto_padre').where;
    expect(padreWhere.creado_por).toBeUndefined();
    if (!esAdmin) expect(padreWhere[Op.or]).toContainEqual({ creado_por: { [Op.in]: [42, 1] } });
    expect(sequelize.query.mock.calls[1][0]).toContain('c.creado_por = :usuario_id');
  });

  test.each(['producto', 'combo', 'todos'])('el origen Gesicom filtra antes de paginar y contar (%s)', async (tipo) => {
    sequelize.query.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await PrecioUsuarioService.listarCatalogoPaginado(42, 1, { tipo, origenCatalogo: 'GESICOMM' });
    for (const [sql] of sequelize.query.mock.calls.slice(0, 2)) {
      if (tipo !== 'combo') expect(sql).toContain('p.creado_por IS DISTINCT FROM :usuario_id');
      if (tipo !== 'producto') {
        expect(sql).toContain('c.creado_por IS DISTINCT FROM :usuario_id');
        expect(sql).toContain('p.categoria_id, c.creado_por');
      }
    }
  });

  test('En mi landing se filtra en SQL antes de paginar', async () => {
    sequelize.query.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await PrecioUsuarioService.listarCatalogoPaginado(42, 1, { tipo: 'landing' }, false, 7);

    const countSql = sequelize.query.mock.calls[0][0];
    const dataSql = sequelize.query.mock.calls[1][0];
    const categoriasSql = sequelize.query.mock.calls[2][0];
    const proveedoresSql = sequelize.query.mock.calls[3][0];

    for (const sql of [countSql, dataSql]) {
      expect(sql).toContain('FROM landing_items li');
      expect(sql).toContain('li.tipo = \'producto\'');
      expect(sql).toContain('li.tipo = \'combo\'');
      expect(sql).toContain('li.referencia_id = p.id');
      expect(sql).toContain('li.referencia_id = c.id');
      expect(sql).toContain('l.tienda_id = :tienda_id');
      expect(sql).toContain('l.activo = true');
      expect(sql).toContain("WHEN l.tipo_pagina = 'catalogo' THEN 0");
      expect(sql).toContain('WHEN l.es_home = true THEN 1');
    }
    expect(dataSql).toContain('LIMIT :limit OFFSET :offset');
    expect(categoriasSql).toContain('FROM landing_items li');
    expect(proveedoresSql).toContain('FROM landing_items li');
    expect(sequelize.query.mock.calls[0][1].replacements).toMatchObject({ tienda_id: 7 });
  });

  test('En mi landing sin tienda activa no cae al catálogo del inquilino', async () => {
    const resultado = await PrecioUsuarioService.listarCatalogoPaginado(42, 1, { tipo: 'landing' }, false, null);

    expect(resultado).toMatchObject({
      items: [],
      total: 0,
      totalPages: 1,
      categorias: [],
      proveedores: [],
      marcas: [],
    });
    expect(sequelize.query).not.toHaveBeenCalled();
  });

  test('despublicar de mi landing quita LandingItem y no elimina el producto del catálogo', async () => {
    const landing = {
      id: 11,
      content: { venta: { configurado: true, seleccion: 'manual' } },
      items: [
        { tipo: 'producto', referencia_id: 1 },
        { tipo: 'combo', referencia_id: 9 },
      ],
      changed: jest.fn(),
      save: jest.fn().mockResolvedValue(),
    };
    Landing.findOne.mockResolvedValue(landing);
    LandingItem.destroy.mockResolvedValue(1);

    const res = await PrecioUsuarioService.despublicarDeLandingActiva(42, 1, [{ tipo: 'producto', id: 1 }], false, 7);

    expect(res).toEqual({ landing_id: 11, despublicados: 1, restantes: 1 });
    expect(Landing.findOne).toHaveBeenCalledWith(expect.objectContaining({
      order: expect.arrayContaining([
        expect.arrayContaining(["CASE WHEN tipo_pagina = 'catalogo' THEN 0 WHEN es_home = true THEN 1 ELSE 2 END", 'ASC']),
      ]),
    }));
    expect(LandingItem.destroy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ landing_id: 11 }),
    }));
    expect(Producto.findAll).not.toHaveBeenCalled();
    expect(landing.content.venta).toMatchObject({ configurado: true, seleccion: 'manual' });
    expect(landing.changed).toHaveBeenCalledWith('content', true);
    expect(landing.save).toHaveBeenCalled();
  });
});

describe('PrecioUsuarioService.organizarEnLandingActiva', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sequelize.transaction = jest.fn(async fn => fn('tx'));
  });

  test('marca como oferta solo lo que ya está en la landing y guarda ancla, badge y contador', async () => {
    const landing = {
      id: 11,
      content: { html: '<lienzo>', venta: { configurado: true, urgencia: { activo: false, productos: [] } } },
      changed: jest.fn(),
      save: jest.fn().mockResolvedValue(),
    };
    const filaLanding = { tipo: 'producto', referencia_id: 1, etiqueta: null, precio_ancla: null, save: jest.fn().mockResolvedValue() };
    Landing.findOne.mockResolvedValue(landing);
    LandingItem.findAll = jest.fn().mockResolvedValue([filaLanding]);
    Producto.findAll.mockResolvedValue([{ id: 1, slug: 'cacerola', precio_base: '100000', precio_tachado: null }]);
    PrecioUsuario.findAll.mockResolvedValue([{ tipo: 'producto', referencia_id: 1, precio: '80000' }]);

    const res = await PrecioUsuarioService.organizarEnLandingActiva(42, 1, {
      accion: 'oferta', pct: 20, badge: 'Oferta', fin_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      items: [{ tipo: 'producto', id: 1 }, { tipo: 'producto', id: 2 }],
    }, false, 7);

    expect(res).toMatchObject({ landing_id: 11, actualizados: 1, fuera_de_landing: 1 });
    expect(filaLanding.precio_ancla).toBe(100000); // 80.000 (su precio) con 20%
    expect(filaLanding.save).toHaveBeenCalledWith({ transaction: 'tx' });
    expect(landing.content.html).toBe('<lienzo>');
    expect(landing.content.venta.urgencia).toMatchObject({ activo: true, productos: ['cacerola'], estado: 'confirmado' });
    expect(landing.content.venta.presentacion_productos['producto:1']).toEqual({ v: 2, insignia_principal: 'Oferta' });
    expect(landing.save).toHaveBeenCalledWith({ transaction: 'tx' });
  });

  test('sin tienda o sin productos de la landing no toca nada', async () => {
    await expect(PrecioUsuarioService.organizarEnLandingActiva(42, 1, { accion: 'quitar_todo', items: [{ tipo: 'producto', id: 1 }] }, false, null))
      .rejects.toThrow(/Seleccioná una tienda/);
    Landing.findOne.mockResolvedValue({ id: 11, content: {}, save: jest.fn() });
    LandingItem.findAll = jest.fn().mockResolvedValue([]);
    await expect(PrecioUsuarioService.organizarEnLandingActiva(42, 1, { accion: 'quitar_todo', items: [{ tipo: 'producto', id: 1 }] }, false, 7))
      .rejects.toThrow(/Ninguno de los productos/);
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
