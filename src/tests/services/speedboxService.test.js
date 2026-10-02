jest.mock('../../models', () => ({
  sequelize: { transaction: jest.fn(), query: jest.fn() },
  Tienda: { findOne: jest.fn() }, Courier: { findOne: jest.fn() }, Envio: { findOne: jest.fn() },
  EnvioItem: { findAll: jest.fn() }, EnvioItemComponente: {}, Producto: {}, ProductoVariante: { findAll: jest.fn() },
  SpeedboxTienda: { findOne: jest.fn(), findOrCreate: jest.fn() }, SpeedboxPedido: { findOrCreate: jest.fn(), findOne: jest.fn() }, SpeedboxEvento: {},
}));
jest.mock('../../services/speedbox/client', () => ({ configuration: jest.fn(() => ({ environment: 'sandbox' })), request: jest.fn(), remoteId: value => String(value), redact: value => value }));
jest.mock('../../services/speedbox/payload', () => ({ buildOrder: jest.fn() }));
const models = require('../../models');
const client = require('../../services/speedbox/client');
const payload = require('../../services/speedbox/payload');
const service = require('../../services/speedbox/service');
function instance(value) { return { ...value, update: jest.fn(async function update(changes) { Object.assign(this, changes); return this; }) }; }
let mapping, envio, connection;
beforeEach(() => {
  jest.clearAllMocks(); process.env.SPEEDBOX_ENVIRONMENT = 'sandbox';
  models.sequelize.transaction.mockImplementation(callback => callback({ LOCK: { UPDATE: 'UPDATE' } }));
  connection = instance({ environment: 'sandbox', tienda_id: '54', courier_id: 2, activo: true });
  envio = instance({ id: 31, usuario_id: 7, courier_id: 2, estado: 'Confirmado', stock_descontado: true });
  mapping = instance({ external_order_id: 'GESICOMM-sandbox-7-31', estado: 'pendiente', intentos: 0 });
  models.SpeedboxTienda.findOne.mockResolvedValue(connection);
  models.Envio.findOne.mockResolvedValue(envio);
  models.SpeedboxPedido.findOrCreate.mockResolvedValue([mapping, true]);
  models.EnvioItem.findAll.mockResolvedValue([{ componentes_vendidos: [] }]);
  models.Tienda.findOne.mockResolvedValue({ nombre: 'Mi tienda' });
  payload.buildOrder.mockReturnValue({ external_order_id: mapping.external_order_id, total_price: 85000 });
  client.request.mockResolvedValue({ ok: true, order: { external_order_id: mapping.external_order_id, order_id: '900000000123456', status: 'pendiente_confirmacion' } });
});
it('keeps the remote ID and records a successful order', async () => {
  expect(await service.sendOrder(7, 31)).toMatchObject({ estado: 'enviado', order_id: '900000000123456' });
  expect(models.Envio.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 31, usuario_id: 7 } }));
});
it('does not submit an already linked order again', async () => {
  mapping.order_id = 'remote-1'; mapping.estado = 'enviado';
  await service.sendOrder(7, 31);
  expect(client.request).not.toHaveBeenCalled();
});
it('rejects orders belonging to another user without an HTTP call', async () => {
  models.Envio.findOne.mockResolvedValue(null);
  await expect(service.sendOrder(7, 32)).rejects.toMatchObject({ status: 404 });
  expect(client.request).not.toHaveBeenCalled();
});
it('rejects an order assigned to another courier', async () => {
  envio.courier_id = 3;
  await expect(service.sendOrder(7, 31)).rejects.toMatchObject({ status: 409 });
  expect(client.request).not.toHaveBeenCalled();
});
it('stores a timeout as uncertain and requires explicit reconciliation', async () => {
  client.request.mockRejectedValueOnce(Object.assign(new Error('Timeout'), { uncertain: true }));
  await expect(service.sendOrder(7, 31)).rejects.toThrow('Timeout');
  expect(mapping.estado).toBe('incierto');
  await expect(service.sendOrder(7, 31, { retry: true })).rejects.toMatchObject({ status: 409 });
  expect(client.request).toHaveBeenCalledTimes(1);
});
it('retries an uncertain request with its original payload and ID', async () => {
  mapping.estado = 'incierto'; mapping.request_payload = { external_order_id: mapping.external_order_id, total_price: 73000 };
  await service.sendOrder(7, 31, { retry: true, acknowledgeUncertain: true });
  expect(client.request).toHaveBeenCalledWith('order', expect.objectContaining({ body: expect.objectContaining({ total_price: 73000 }) }));
  expect(payload.buildOrder).not.toHaveBeenCalled();
});
it('does not resend a currently running submission', async () => {
  mapping.estado = 'enviando'; mapping.updated_at = new Date();
  await expect(service.sendOrder(7, 31, { retry: true, acknowledgeUncertain: true })).rejects.toMatchObject({ status: 409 });
  expect(client.request).not.toHaveBeenCalled();
});
it('persists validation errors for the panel', async () => {
  payload.buildOrder.mockImplementationOnce(() => { throw Object.assign(new Error('Falta SKU'), { status: 422 }); });
  await expect(service.sendOrder(7, 31)).rejects.toMatchObject({ status: 422 });
  expect(mapping.estado).toBe('error');
  expect(mapping.error).toBe('Falta SKU');
  expect(client.request).not.toHaveBeenCalled();
});
it('does not free stock for a locally cancelled remote submission', async () => {
  models.SpeedboxPedido.findOne.mockResolvedValue(mapping);
  await expect(service.assertCanChange(envio, { estado: 'Cancelado' }, {})).rejects.toMatchObject({ status: 409 });
});
it('allows payment edits and the same courier on a remote order', async () => {
  models.SpeedboxPedido.findOne.mockResolvedValue(mapping);
  await expect(service.assertCanChange(envio, { courier_id: 2 }, {})).resolves.toBeUndefined();
  await expect(service.assertCanChange(envio, { monto: 85000 }, {})).resolves.toBeUndefined();
});
