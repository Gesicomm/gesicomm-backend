jest.mock('../models', () => ({
  Usuario: { findAll: jest.fn() }, Rol: {},
  Producto: { findAll: jest.fn() }, ProductoVariante: { findAll: jest.fn() },
  InventarioUbicacion: { findAll: jest.fn() }, Deposito: {},
}));
const { Usuario, Producto, ProductoVariante, InventarioUbicacion } = require('../models');
const { ajustarStockALaTienda } = require('../services/stockPorTienda.service');
const Pricing = require('../services/pricing.service');
const { porcentajeDescuento } = require('../utils/porcentajeDescuento');
const tienda = { id: 3, usuario_id: 20, inquilino_id: 1 };
beforeEach(() => {
  jest.clearAllMocks();
  Usuario.findAll.mockResolvedValue([{ id: 1 }]);
  InventarioUbicacion.findAll.mockResolvedValue([]);
  Producto.findAll.mockResolvedValue([]);
  ProductoVariante.findAll.mockResolvedValue([]);
});
test('admin y catálogo global tienen stock ilimitado, el comercio conserva su stock', async () => {
  const productos = [
    { id: 10, creado_por: 1, cantidad_disponible: 0 },
    { id: 11, creado_por: null, cantidad_disponible: 0 },
    { id: 12, creado_por: 20, cantidad_disponible: 0 },
    { id: 13, creado_por: 20, cantidad_disponible: 5 },
  ];
  const variantes = [{ id: 30, producto_id: 10, stock: 0 }, { id: 31, producto_id: 12, stock: 0 }];
  await ajustarStockALaTienda(tienda, { productos, variantes });
  expect(productos.map(p => p.cantidad_disponible)).toEqual([null, null, 0, 5]);
  expect(variantes.map(v => v.stock)).toEqual([null, 0]);
  expect(Pricing.validarStock({ stock_disponible: productos[0].cantidad_disponible, cantidad: 100 }).suficiente).toBe(true);
  expect(Pricing.validarStock({ stock_disponible: productos[2].cantidad_disponible, cantidad: 1 }).suficiente).toBe(false);
});
test('una variante elegida al resolver el carrito hereda stock ilimitado de su padre admin', async () => {
  Producto.findAll.mockResolvedValue([{ id: 10, creado_por: 1 }]);
  const variante = { id: 30, producto_id: 10, stock: 0 };
  await ajustarStockALaTienda(tienda, { variantes: [variante] });
  expect(variante.stock).toBeNull();
});
test('no limita el catálogo admin al repartir stock entre tiendas', async () => {
  const productos = [{ id: 10, creado_por: 1, cantidad_disponible: 0 }, { id: 12, creado_por: 20, cantidad_disponible: 8 }];
  InventarioUbicacion.findAll.mockResolvedValue([
    { producto_id: 10, cantidad_disponible: 10, Deposito: { tienda_id: 4 } },
    { producto_id: 12, cantidad_disponible: 8, Deposito: { tienda_id: 4 } },
  ]);
  await ajustarStockALaTienda(tienda, { productos });
  expect(productos.map(p => p.cantidad_disponible)).toEqual([null, 0]);
});
test('el descuento conserva decimales y nunca redondea un ahorro real a cero', () => {
  expect(porcentajeDescuento(1000000, 997434)).toBe(0.26);
  expect(porcentajeDescuento(100000, 85000)).toBe(15);
  expect(porcentajeDescuento(1000000, 999999)).toBe(0.0001);
  expect(porcentajeDescuento(1000, 1000)).toBe(0);
});
