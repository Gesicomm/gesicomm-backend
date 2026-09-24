/**
 * LandingService.itemsDelLienzo — la lista de productos de una landing HTML.
 * Todo lo que la landing muestra, pagina, cobra y trackea sale de acá, así
 * que si esto se equivoca la landing muestra un producto que después el
 * checkout rechaza. Modelos mockeados: se verifica la lógica y la forma de
 * las consultas, no la base.
 */

const mockProductoFindAll = jest.fn();
const mockComboFindAll = jest.fn();
jest.mock('../models', () => ({
  Producto: { findAll: (...a) => mockProductoFindAll(...a), count: jest.fn() },
  ProductoCombo: { findAll: (...a) => mockComboFindAll(...a), count: jest.fn() },
}));
for (const m of [
  '../services/pricing.service', '../services/tarifaDelivery.service', '../services/fulfillment.service',
  '../services/payments/paymentService', '../services/canalVenta.service', '../services/cupon.service',
  '../services/pedidoNumeracion.service', '../services/metaCapi.service', '../services/imagen.service',
  '../utils/rangoFechas', '../utils/historial',
]) jest.mock(m, () => ({}));

const { Op } = require('sequelize');
const LandingService = require('../services/landing.service');

const tienda = { inquilino_id: 7 };
const reglaTodos = { configurado: true, seleccion: 'todos', tipo: 'catalogo' };

beforeEach(() => {
  mockProductoFindAll.mockReset().mockResolvedValue([]);
  mockComboFindAll.mockReset().mockResolvedValue([]);
});

describe('regla "todos" / "por categoría"', () => {
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
