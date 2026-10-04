jest.mock('../models', () => ({}));
jest.mock('../services/comboConfiguracion.service', () => ({}));
jest.mock('../services/combo.service', () => ({}));
jest.mock('../services/imagen.service', () => ({}));
const Svc = require('../services/precioUsuario.service');

describe('Precio público de la vitrina para preview', () => {
  beforeAll(() => { jest.useFakeTimers().setSystemTime(new Date('2026-10-03T12:00:00Z')); });
  afterAll(() => jest.useRealTimers());
  const producto = { precio_base: '159000', descuento_porcentaje: 10, descuento_inicio: '2026-10-01', descuento_fin: '2026-10-30', precio_minimo: null };
  test('aplica el descuento vigente como la landing publicada', () => {
    expect(Svc.precioPublico(producto, null)).toEqual({ precio_publico: 143100, precio_publico_base: 143100 });
  });
  test('respeta el precio del comercio y el piso vigente', () => {
    expect(Svc.precioPublico({ ...producto, precio_minimo: 150000 }, 145000)).toEqual({ precio_publico: 150000, precio_publico_base: 145000 });
  });
  test('no aplica un descuento fuera de la ventana', () => {
    expect(Svc.precioPublico({ ...producto, descuento_fin: '2026-10-02' }, null).precio_publico).toBe(159000);
  });
});
