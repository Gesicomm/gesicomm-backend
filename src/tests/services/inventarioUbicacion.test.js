jest.mock('../../models', () => ({ sequelize: { query: jest.fn() },
  InventarioUbicacion: { findOrCreate: jest.fn() }, Deposito: { findOne: jest.fn() }, ProductoVariante: { findOne: jest.fn() } }));
const m = require('../../models');
const { acreditar } = require('../../services/inventarioUbicacion.service');
const input = { usuario_id: 3, producto_id: 5, variante_id: 7, deposito_id: 2, cantidad: 4, alcance: 'GESICOMM' };
let row;
beforeEach(() => {
  jest.clearAllMocks(); row = { increment: jest.fn() };
  m.Deposito.findOne.mockResolvedValue({ id: 2 });
  m.ProductoVariante.findOne.mockResolvedValue({ id: 7 });
  m.InventarioUbicacion.findOrCreate.mockResolvedValue([row, true]);
});
it('isolates owner/product/variant/depot and increments atomically under a shared lock', async () => {
  const transaction = {};
  await acreditar(input, transaction);
  expect(m.InventarioUbicacion.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
    where: { usuario_id: 3, producto_id: 5, variante_id: 7, deposito_id: 2 }, transaction }));
  expect(row.increment).toHaveBeenCalledWith('cantidad_disponible', { by: 4, transaction });
  expect(m.sequelize.query.mock.invocationCallOrder[0]).toBeLessThan(m.InventarioUbicacion.findOrCreate.mock.invocationCallOrder[0]);
});
it('requires active own deposits for own reception, or an active Gesicomm center', async () => {
  await acreditar({ ...input, alcance: 'PROPIO' }, {});
  expect(m.Deposito.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2, activo: true, usuario_id: 3, alcance: 'PROPIO' } }));
  m.Deposito.findOne.mockResolvedValueOnce(null);
  await expect(acreditar(input, {})).rejects.toMatchObject({ status: 400 });
});
it('does not credit inactive variants or variants of another product', async () => {
  m.ProductoVariante.findOne.mockResolvedValueOnce(null);
  await expect(acreditar(input, {})).rejects.toMatchObject({ status: 400 });
  expect(m.InventarioUbicacion.findOrCreate).not.toHaveBeenCalled();
  expect(m.ProductoVariante.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7, producto_id: 5, activo: true } }));
});
it.each([0, -1, 1.5, NaN, Infinity])('does not credit an invalid quantity %s', async cantidad => {
  await expect(acreditar({ ...input, cantidad }, {})).rejects.toMatchObject({ status: 400 });
  expect(m.InventarioUbicacion.findOrCreate).not.toHaveBeenCalled();
});
