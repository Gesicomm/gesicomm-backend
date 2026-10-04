/**
 * LandingService.itemsDelLienzo — la lista de productos de una landing HTML.
 * Todo lo que la landing muestra, pagina, cobra y trackea sale de acá, así
 * que si esto se equivoca la landing muestra un producto que después el
 * checkout rechaza. Modelos mockeados: se verifica la lógica y la forma de
 * las consultas, no la base.
 */

const mockProductoFindAll = jest.fn();
const mockComboFindAll = jest.fn();
const mockProductoCount = jest.fn();
const mockComboCount = jest.fn();
const mockUsuarioFindAll = jest.fn();
jest.mock('../models', () => ({
  Producto: { findAll: (...a) => mockProductoFindAll(...a), count: (...a) => mockProductoCount(...a) },
  ProductoCombo: { findAll: (...a) => mockComboFindAll(...a), count: (...a) => mockComboCount(...a) },
  // obtenerIdsAdministradores (precioUsuario.service)
  Usuario: { findAll: (...a) => mockUsuarioFindAll(...a) },
  Rol: {},
}));
for (const m of [
  '../services/pricing.service', '../services/tarifaDelivery.service', '../services/fulfillment.service',
  '../services/payments/paymentService', '../services/canalVenta.service', '../services/cupon.service',
  '../services/pedidoNumeracion.service', '../services/metaCapi.service', '../services/imagen.service',
  '../utils/rangoFechas', '../utils/historial',
]) jest.mock(m, () => ({}));

const { Op } = require('sequelize');
const LandingService = require('../services/landing.service');

const ADMIN = 1;
const DUENO = 20;
const OTRO = 99;
const tienda = { inquilino_id: 7, usuario_id: DUENO };
const reglaTodos = { configurado: true, seleccion: 'todos', tipo: 'catalogo' };

beforeEach(() => {
  mockProductoFindAll.mockReset().mockResolvedValue([]);
  mockComboFindAll.mockReset().mockResolvedValue([]);
  mockProductoCount.mockReset().mockResolvedValue(0);
  mockComboCount.mockReset().mockResolvedValue(0);
  mockUsuarioFindAll.mockReset().mockResolvedValue([{ id: ADMIN }]);
});

describe('regla "todos" / "por categoría"', () => {
  it('conserva ancla y etiquetas de cada producto sin excluir los nuevos de una regla', async () => {
    mockProductoFindAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    mockComboFindAll.mockResolvedValue([{ id: 1 }]);
    const items = await LandingService.itemsDelLienzo({ content: { venta: reglaTodos }, items: [
      { tipo: 'producto', referencia_id: 1, precio_ancla: 1200000, etiqueta: 'Cocina, Oferta', mostrar_en_inicio: false, envio_incluido: true },
    ] }, tienda);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ tipo: 'producto', referencia_id: 1, precio_ancla: 1200000, etiqueta: 'Cocina, Oferta', mostrar_en_inicio: false, envio_incluido: true });
    expect(items[1]).toMatchObject({ referencia_id: 2, precio_ancla: null, mostrar_en_inicio: true });
    expect(items[2]).toMatchObject({ tipo: 'combo', referencia_id: 1, precio_ancla: null, etiqueta: null });
  });

  it('no tiene tope: sin límite la consulta no lleva limit', async () => {
    mockProductoFindAll.mockResolvedValue(Array.from({ length: 222 }, (_, i) => ({ id: i + 1 })));
    const items = await LandingService.itemsDelLienzo({ content: { venta: reglaTodos } }, tienda);
    expect(items).toHaveLength(222);
    const opciones = mockProductoFindAll.mock.calls[0][0];
    expect(opciones.limit).toBeUndefined();
    expect(opciones.where).toEqual(expect.objectContaining({ inquilino_id: 7, activo: true, estado_venta: 'en_venta' }));
  });

  it('la primera página pide solo N y combos después de productos (o antes, si la venta es de combos)', async () => {
    mockProductoFindAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    mockComboFindAll.mockResolvedValue([{ id: 9 }]);
    const catalogo = await LandingService.itemsDelLienzo({ content: { venta: reglaTodos } }, tienda, { limite: 2 });
    expect(mockProductoFindAll.mock.calls[0][0].limit).toBe(2);
    expect(catalogo.map(i => `${i.tipo}:${i.referencia_id}`)).toEqual(['producto:1', 'producto:2']);

    const combos = await LandingService.itemsDelLienzo({ content: { venta: { ...reglaTodos, tipo: 'combos' } } }, tienda, { limite: 2 });
    expect(combos.map(i => `${i.tipo}:${i.referencia_id}`)).toEqual(['combo:9', 'producto:1']);
  });

  it('por categoría filtra por nombre de categoría, y sin categorías no vende nada', async () => {
    await LandingService.itemsDelLienzo({ content: { venta: { ...reglaTodos, seleccion: 'categoria', categorias: ['Cocina'] } } }, tienda);
    const include = mockProductoFindAll.mock.calls[0][0].include[0];
    expect(include).toEqual(expect.objectContaining({ association: 'categoria', required: true }));
    expect(include.where.nombre[Op.in]).toEqual(['Cocina']);

    mockProductoFindAll.mockClear();
    const vacio = await LandingService.itemsDelLienzo({ content: { venta: { ...reglaTodos, seleccion: 'categoria', categorias: [] } } }, tienda);
    expect(vacio).toEqual([]);
    expect(mockProductoFindAll).not.toHaveBeenCalled();
  });

  it('el carrito resuelve solo los content_ids pedidos (slug, producto-N, combo-N)', async () => {
    await LandingService.itemsDelLienzo({ content: { venta: reglaTodos } }, tienda, { contentIds: ['air-fryer', 'producto-5', 'combo-3'] });
    const where = mockProductoFindAll.mock.calls[0][0].where;
    expect(where[Op.or]).toEqual([{ slug: { [Op.in]: ['air-fryer'] } }, { id: { [Op.in]: [5] } }]);
    expect(mockComboFindAll.mock.calls[0][0].where.id[Op.in]).toEqual([3]);
  });

  it('sin combos en la regla no los consulta', async () => {
    await LandingService.itemsDelLienzo({ content: { venta: { ...reglaTodos, incluir_combos: false } } }, tienda);
    expect(mockComboFindAll).not.toHaveBeenCalled();
  });

  it('la ficha asegura el producto aunque no esté en la primera página', async () => {
    mockProductoFindAll
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ id: 150 }]);
    const items = await LandingService.itemsDelLienzo({ content: { venta: reglaTodos } }, tienda, { limite: 1, asegurar: 'producto-150' });
    expect(items.map(i => i.referencia_id)).toEqual([1, 150]);
  });
});

describe('lista manual', () => {
  const landing = {
    content: { venta: { configurado: true, seleccion: 'manual' } },
    items: [
      { tipo: 'producto', referencia_id: 3, orden: 1 },
      { tipo: 'producto', referencia_id: 1, orden: 0 },
      { tipo: 'combo', referencia_id: 9, orden: 2 },
    ],
  };

  it('respeta el orden y el límite de la primera página', async () => {
    const items = await LandingService.itemsDelLienzo(landing, tienda, { limite: 2 });
    expect(items.map(i => i.referencia_id)).toEqual([1, 3]);
  });

  it('el carrito solo acepta productos que están en la lista', async () => {
    mockProductoFindAll.mockResolvedValue([{ id: 3 }]); // slug "remera" → id 3
    const items = await LandingService.itemsDelLienzo(landing, tienda, { contentIds: ['remera', 'combo-9', 'combo-99', 'producto-42'] });
    expect(items.map(i => `${i.tipo}:${i.referencia_id}`).sort()).toEqual(['combo:9', 'producto:3']);
  });
});

/**
 * Evalúa un where de Sequelize contra una fila, solo lo que usan estas
 * consultas (igualdad, null, Op.in, Op.or, Op.and). Así los mocks devuelven
 * lo que la base devolvería y el test prueba el efecto, no la forma.
 */
function cumple(where, fila) {
  return Object.keys(where).every(k => {
    const v = where[k];
    if (k === 'inquilino_id' || k === 'activo' || k === 'estado_venta' || k === 'estado') return true;
    return v && typeof v === 'object' && v[Op.in] ? v[Op.in].includes(fila[k]) : fila[k] === v;
  }) && Object.getOwnPropertySymbols(where).every(sym => {
    if (sym === Op.and) return where[sym].every(w => cumple(w, fila));
    if (sym === Op.or) return where[sym].some(w => cumple(w, fila));
    throw new Error(`operador no soportado en el test: ${String(sym)}`);
  });
}

const PRODUCTOS = [
  { id: 1, creado_por: null, slug: 'viejo' },
  { id: 2, creado_por: ADMIN, slug: 'del-admin' },
  { id: 3, creado_por: DUENO, slug: 'mio' },
  { id: 4, creado_por: OTRO, slug: 'ajeno' },
];
const COMBOS = [
  { id: 10, creado_por: null },
  { id: 11, creado_por: ADMIN },
  { id: 12, creado_por: DUENO },
  { id: 13, creado_por: OTRO },
];

describe('catálogo por regla: solo lo que la tienda puede vender (tenant único)', () => {
  beforeEach(() => {
    mockProductoFindAll.mockImplementation(async ({ where }) => PRODUCTOS.filter(p => cumple(where, p)));
    mockComboFindAll.mockImplementation(async ({ where }) => COMBOS.filter(c => cumple(where, c)));
    mockProductoCount.mockImplementation(async ({ where }) => PRODUCTOS.filter(p => cumple(where, p)).length);
    mockComboCount.mockImplementation(async ({ where }) => COMBOS.filter(c => cumple(where, c)).length);
  });

  const ids = items => items.map(i => `${i.tipo}:${i.referencia_id}`).sort();

  it('"todo el catálogo" no trae productos ni combos de otro usuario', async () => {
    const items = await LandingService.itemsDelLienzo({ content: { venta: reglaTodos } }, tienda);
    expect(ids(items)).toEqual(['combo:11', 'combo:12', 'producto:1', 'producto:2', 'producto:3']);
  });

  it('"por categoría" aplica el mismo filtro de dueño', async () => {
    const items = await LandingService.itemsDelLienzo(
      { content: { venta: { ...reglaTodos, seleccion: 'categoria', categorias: ['Cocina'] } } }, tienda);
    expect(ids(items)).not.toContain('producto:4');
    expect(ids(items)).not.toContain('combo:13');
  });

  it('el contador ("N productos") coincide con la lista', async () => {
    const total = await LandingService.contarLienzo({ content: { venta: reglaTodos } }, tienda);
    expect(total).toBe(5);
  });

  it('carrito y eventos: pedir por id o slug un ítem ajeno no lo resuelve, y el Op.or de content_ids no pisa el filtro', async () => {
    const items = await LandingService.itemsDelLienzo({ content: { venta: reglaTodos } }, tienda, {
      contentIds: ['ajeno', 'producto-4', 'mio', 'combo-13', 'combo-12'],
    });
    expect(ids(items)).toEqual(['combo:12', 'producto:3']);
  });

  it('el combo sin dueño (anterior a creado_por) solo entra en la tienda de un admin', async () => {
    const deAdmin = await LandingService.itemsDelLienzo({ content: { venta: reglaTodos } }, { inquilino_id: 7, usuario_id: ADMIN });
    expect(ids(deAdmin)).toEqual(['combo:10', 'combo:11', 'producto:1', 'producto:2']);
  });

  it('sin configurar (fallback) tampoco trae productos ajenos', async () => {
    const items = await LandingService.itemsDelLienzo({ content: {}, items: [] }, tienda);
    expect(ids(items)).toEqual(['producto:1', 'producto:2', 'producto:3']);
  });

  it('checkout (itemsSegunReglaCodigo): no se puede comprar lo que la landing no muestra', async () => {
    const landing = { content: { venta: reglaTodos } };
    const acotar = { producto: [4, 3], combo: [13, 11], slugs: ['ajeno'] };
    const items = await LandingService.itemsSegunReglaCodigo(landing, tienda, acotar);
    expect(ids(items)).toEqual(['combo:11', 'producto:3']);

    const vista = await LandingService.itemsSegunReglaCodigo(landing, tienda);
    expect(ids(vista)).toEqual(['combo:11', 'combo:12', 'producto:1', 'producto:2', 'producto:3']);
  });

  it('una tienda sin dueño resuelto no ve nada ajeno (falla cerrado)', async () => {
    const items = await LandingService.itemsDelLienzo({ content: { venta: reglaTodos } }, { inquilino_id: 7 });
    expect(ids(items)).toEqual(['combo:11', 'producto:1', 'producto:2']);
  });
});

describe('LandingService.vistasPublicas — ficha propia por producto', () => {
  const content = {
    vistas: {
      producto: { html: '<p>general</p>', css: '', js: '' },
      productos: { adelfit: { html: '<p>adelfit</p>', css: '', js: '' }, 'combo-3': { html: '<p>combo</p>', css: '', js: '' } },
    },
    venta: { abrir_en: 'tienda' },
  };

  it('manda la general y SOLO la ficha propia del producto pedido', () => {
    expect(LandingService.vistasPublicas(content, 'combo-3')).toEqual({
      producto: content.vistas.producto,
      productos: { 'combo-3': content.vistas.productos['combo-3'] },
    });
  });

  it('en el inicio de una tienda no manda fichas propias', () => {
    expect(LandingService.vistasPublicas(content, null, 'adelfit')).toEqual({ producto: content.vistas.producto });
  });

  it('"directo en un producto": manda la ficha propia del principal', () => {
    const directo = { ...content, venta: { abrir_en: 'producto' } };
    expect(LandingService.vistasPublicas(directo, null, 'adelfit').productos).toEqual({ adelfit: content.vistas.productos.adelfit });
  });
});
