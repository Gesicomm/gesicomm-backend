jest.mock('../models', () => ({
  Producto: { findAll: jest.fn().mockResolvedValue([]) },
  ProductoCombo: { findAll: jest.fn() },
  ProductoImagen: { findAll: jest.fn().mockResolvedValue([]) },
  PrecioUsuario: { findAll: jest.fn().mockResolvedValue([]) },
  Usuario: { findAll: jest.fn().mockResolvedValue([{ id: 1 }]) }, Rol: {},
}));
jest.mock('../services/comboConfiguracion.service', () => ({}));
jest.mock('../services/combo.service', () => ({}));
jest.mock('../services/imagen.service', () => ({}));
const { ProductoCombo, PrecioUsuario } = require('../models');
const Svc = require('../services/precioUsuario.service');
describe('Valor por separado del combo en preview', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2026-10-03T12:00:00Z')));
  afterAll(() => jest.useRealTimers());
  beforeEach(() => {
    PrecioUsuario.findAll.mockResolvedValue([]);
    ProductoCombo.findAll.mockResolvedValue([{
      id: 2, nombre: 'Combo QA', precio_total: 304000,
      producto_padre: { id: 1, nombre: 'Vestido QA', precio_base: 240000, descuento_porcentaje: 15, descuento_inicio: '2026-10-01', descuento_fin: '2026-10-30', beneficios: [] },
      items: [{ cantidad: 1, producto_incluido: { id: 3, nombre: 'Complemento QA', precio_base: 80000, beneficios: [] } }],
    }]);
  });
  test('muestra el valor individual vigente de la página pública sin alterar el precio fijo del combo', async () => {
    const data = await Svc.listarCatalogo(202, 2);
    expect(data.combos[0].productos_combo.map(p => p.precio)).toEqual([204000, 80000]);
    expect(data.combos[0].precio_efectivo).toBe(304000);
    const includes = ProductoCombo.findAll.mock.calls.at(-1)[0].include;
    expect(includes.find(i => i.as === 'producto_padre').attributes).toContain('descuento_porcentaje');
    expect(includes.find(i => i.as === 'items').include[0].attributes).toContain('descuento_fin');
  });
  test('respeta el precio personalizado de la tienda en los componentes', async () => {
    PrecioUsuario.findAll.mockResolvedValue([{ tipo: 'producto', referencia_id: 1, precio: 215000 }]);
    const data = await Svc.listarCatalogo(202, 2);
    expect(data.combos[0].productos_combo[0].precio).toBe(215000);
  });
});
