jest.mock('../models', () => {
  const modelo = () => ({ count: jest.fn(), findAll: jest.fn(), destroy: jest.fn() });
  return {
    sequelize: { transaction: jest.fn() }, Producto: { findOne: jest.fn() },
    HistorialPrecio: {}, ProductoVariante: {}, Oferta: {}, ProductoFaq: {}, Deposito: {},
    OfertaComponente: modelo(), PrecioUsuario: modelo(), InventarioUbicacion: modelo(),
    LandingItem: modelo(), ProductoCombo: modelo(), ProductoComboItem: modelo(), ProductoRelacionado: modelo(),
    EnvioItemComponente: modelo(), IngresoInventarioItem: modelo(), SolicitudAbastecimiento: modelo(),
  };
});
const modelos = require('../models');
const ProductoService = require('../services/producto.service');
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
let producto;
beforeEach(() => {
  jest.clearAllMocks();
  modelos.sequelize.transaction.mockImplementation(fn => fn(transaction));
  producto = { id: 10, creado_por: 7, destroy: jest.fn().mockResolvedValue(1), save: jest.fn() };
  modelos.Producto.findOne.mockResolvedValue(producto);
  for (const nombre of ['EnvioItemComponente', 'IngresoInventarioItem', 'SolicitudAbastecimiento', 'ProductoComboItem', 'OfertaComponente']) modelos[nombre].count.mockResolvedValue(0);
  modelos.ProductoCombo.findAll.mockResolvedValue([{ id: 23 }]);
});
test('borra físicamente y limpia referencias de landing, precios e inventario en una misma transacción', async () => {
  await expect(ProductoService.eliminar(10, 1, 7, false, 4)).resolves.toBe(true);
  expect(producto.save).not.toHaveBeenCalled();
  expect(producto.destroy).toHaveBeenCalledWith({ transaction, force: true });
  expect(modelos.LandingItem.destroy).toHaveBeenCalledWith({ where: { tipo: 'producto', referencia_id: 10 }, transaction });
  expect(modelos.PrecioUsuario.destroy).toHaveBeenCalledWith({ where: { tipo: 'producto', referencia_id: 10 }, transaction });
  expect(modelos.LandingItem.destroy).toHaveBeenCalledTimes(2);
  expect(modelos.InventarioUbicacion.destroy).toHaveBeenCalledWith({ where: { producto_id: 10 }, transaction });
});
test('rechaza productos de otro dueño sin modificar datos', async () => {
  await expect(ProductoService.eliminar(10, 1, 8, false, 4)).rejects.toMatchObject({ status: 403 });
  expect(producto.destroy).not.toHaveBeenCalled();
  expect(modelos.LandingItem.destroy).not.toHaveBeenCalled();
});
test.each(['EnvioItemComponente', 'IngresoInventarioItem', 'SolicitudAbastecimiento', 'ProductoComboItem', 'OfertaComponente'])('protege dependencias de %s antes de borrar', async nombre => {
  modelos[nombre].count.mockResolvedValue(1);
  await expect(ProductoService.eliminar(10, 1, 7, false, 4)).rejects.toMatchObject({ status: 409 });
  expect(producto.destroy).not.toHaveBeenCalled();
  expect(modelos.LandingItem.destroy).not.toHaveBeenCalled();
});
test('propaga un fallo del borrado para que la transacción revierta la limpieza', async () => {
  producto.destroy.mockRejectedValue(new Error('fallo de FK'));
  await expect(ProductoService.eliminar(10, 1, 7, false, 4)).rejects.toThrow('fallo de FK');
});
