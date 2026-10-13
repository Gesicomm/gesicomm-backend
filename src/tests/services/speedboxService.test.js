jest.mock('../../models', () => ({
  sequelize: { transaction: jest.fn(), query: jest.fn() },
  Tienda: { findOne: jest.fn() }, Courier: { findOne: jest.fn() }, Envio: { findOne: jest.fn() },
  EnvioItem: { findAll: jest.fn() }, EnvioItemComponente: { findAll: jest.fn() }, Producto: {}, ProductoVariante: { findAll: jest.fn() },
  SpeedboxTienda: { findOne: jest.fn(), findOrCreate: jest.fn() }, SpeedboxPedido: { findOrCreate: jest.fn(), findOne: jest.fn() }, SpeedboxEvento: {},
}));
jest.mock('../../services/speedbox/client', () => ({ configuration: jest.fn(() => ({ environment: 'sandbox' })), request: jest.fn(), remoteId: value => String(value), redact: value => value }));
jest.mock('../../services/speedbox/payload', () => ({ buildOrder: jest.fn() }));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn() } }));
const models = require('../../models');
const client = require('../../services/speedbox/client');
const payload = require('../../services/speedbox/payload');
const service = require('../../services/speedbox/service');
function instance(value) { return { ...value, update: jest.fn(async function update(changes) { Object.assign(this, changes); return this; }) }; }
let mapping, envio, connection;
const originalEnabled = process.env.SPEEDBOX_ENABLED;
const originalRegistration = process.env.SPEEDBOX_REGISTRATION_URL;
beforeEach(() => {
  jest.clearAllMocks(); process.env.SPEEDBOX_ENVIRONMENT = 'sandbox';
  process.env.SPEEDBOX_ENABLED = 'false';
  delete process.env.SPEEDBOX_REGISTRATION_URL;
  models.sequelize.transaction.mockImplementation(callback => callback({ LOCK: { UPDATE: 'UPDATE' } }));
  connection = instance({ environment: 'sandbox', tienda_id: '54', courier_id: 2, activo: true });
  envio = instance({ id: 31, usuario_id: 7, courier_id: 2, estado: 'Confirmado', stock_descontado: true });
  mapping = instance({ external_order_id: 'GESICOMM-sandbox-7-31', estado: 'pendiente', intentos: 0 });
  models.SpeedboxTienda.findOne.mockResolvedValue(connection);
  models.SpeedboxTienda.findOrCreate.mockResolvedValue([connection, false]);
  models.Envio.findOne.mockResolvedValue(envio);
  models.SpeedboxPedido.findOrCreate.mockResolvedValue([mapping, true]);
  models.EnvioItemComponente.findAll.mockResolvedValue([]);
  models.EnvioItem.findAll.mockResolvedValue([{ componentes_vendidos: [] }]);
  models.Tienda.findOne.mockResolvedValue({ nombre: 'Mi tienda' });
  payload.buildOrder.mockReturnValue({ external_order_id: mapping.external_order_id, total_price: 85000 });
  client.request.mockResolvedValue({ ok: true, order: { external_order_id: mapping.external_order_id, order_id: '900000000123456', status: 'pendiente_confirmacion' } });
});
afterEach(() => {
  if (originalEnabled === undefined) delete process.env.SPEEDBOX_ENABLED;
  else process.env.SPEEDBOX_ENABLED = originalEnabled;
  if (originalRegistration === undefined) delete process.env.SPEEDBOX_REGISTRATION_URL;
  else process.env.SPEEDBOX_REGISTRATION_URL = originalRegistration;
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
it('sends a Raha catalog order even when the local courier is different', async () => {
  envio.courier_id = 3;
  models.EnvioItemComponente.findAll.mockResolvedValue([{ producto: { id: 9, creado_por: 1 } }]);
  await service.sendOrder(7, 31);
  expect(payload.buildOrder).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.anything(),
    expect.any(Map),
    { onlyExternalProducts: true, usuarioId: 7 },
  );
  expect(client.request).toHaveBeenCalledTimes(1);
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

it('verifies the sandbox spec with pasted credentials without persisting them', async () => {
  await expect(service.verifySpec(7, { public_key: ' sbx_public ', private_key: ' private_secret ' })).resolves.toEqual({ ok: true });
  expect(client.request).toHaveBeenCalledWith('spec', { credentials: { environment: 'sandbox', apiKey: 'sbx_public', secret: 'private_secret' } });
  expect(models.SpeedboxTienda.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
    where: { usuario_id: 7, environment: 'sandbox' },
  }));
  expect(connection.update).toHaveBeenCalledWith({ spec_verified_at: expect.any(Date) });
});

it('sends a sandbox validation order using pasted credentials', async () => {
  client.request.mockImplementationOnce(async (_action, options) => ({
    ok: true,
    order: { external_order_id: options.body.external_order_id, order_id: '900000000123456', status: 'recibido' },
  }));
  await expect(service.verifyOrder(7, { public_key: 'sbx_public', private_key: 'private_secret' })).resolves.toMatchObject({
    ok: true, order_id: '900000000123456', status: 'recibido',
  });
  const [, call] = client.request.mock.calls[0];
  expect(client.request.mock.calls[0][0]).toBe('order');
  expect(call.credentials).toEqual({ environment: 'sandbox', apiKey: 'sbx_public', secret: 'private_secret' });
  expect(call.body).toMatchObject({ tienda_id: '54', items: [{ sku: 'GESICOM-TEST-001', quantity: 1 }] });
  expect(call.body.external_order_id).toMatch(/^GESICOMM-TEST-sandbox-7-/);
  expect(connection.update).toHaveBeenCalledWith({ order_verified_at: expect.any(Date) });
});

it('queues confirmation even when procurement payment is pending, without sending before commit', async () => {
  process.env.SPEEDBOX_ENABLED = 'true';
  envio.abastecimiento_estado = 'pendiente_pago';
  const transaction = { afterCommit: jest.fn() };
  await service.queueConfirmedOrder(envio, transaction);
  expect(models.SpeedboxPedido.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({ transaction,
    where: { environment: 'sandbox', envio_id: 31 }, defaults: expect.objectContaining({ usuario_id: 7 }) }));
  expect(transaction.afterCommit).toHaveBeenCalledTimes(1);
  expect(client.request).not.toHaveBeenCalled();
});

it.each(['Pendiente', 'Cancelado', 'Preparado'])('does not queue a %s order as a confirmation', async estado => {
  process.env.SPEEDBOX_ENABLED = 'true'; envio.estado = estado;
  expect(await service.queueConfirmedOrder(envio, { afterCommit: jest.fn() })).toBeNull();
  expect(models.SpeedboxPedido.findOrCreate).not.toHaveBeenCalled();
});

it('does not queue when automation is disabled', async () => {
  expect(await service.queueConfirmedOrder(envio, {})).toBeNull();
  expect(models.SpeedboxPedido.findOrCreate).not.toHaveBeenCalled();
});

it('does not queue a different courier or an unlinked store', async () => {
  process.env.SPEEDBOX_ENABLED = 'true'; envio.courier_id = 3;
  expect(await service.queueConfirmedOrder(envio, {})).toBeNull();
  envio.courier_id = 2; connection.tienda_id = null;
  expect(await service.queueConfirmedOrder(envio, {})).toBeNull();
  expect(models.SpeedboxPedido.findOrCreate).not.toHaveBeenCalled();
});

it('queues Raha catalog products even when the selected courier is not Speedbox', async () => {
  process.env.SPEEDBOX_ENABLED = 'true';
  envio.courier_id = 3;
  models.EnvioItemComponente.findAll.mockResolvedValue([{ producto: { id: 9, creado_por: 1 } }]);
  const transaction = { afterCommit: jest.fn() };
  await service.queueConfirmedOrder(envio, transaction);
  expect(models.SpeedboxPedido.findOrCreate).toHaveBeenCalled();
  expect(transaction.afterCommit).toHaveBeenCalledTimes(1);
});

it('queues Raha catalog products even when the order has no local courier', async () => {
  process.env.SPEEDBOX_ENABLED = 'true';
  envio.courier_id = null;
  models.EnvioItemComponente.findAll.mockResolvedValue([{ producto: { id: 9, creado_por: 1 } }]);
  const transaction = { afterCommit: jest.fn() };
  await service.queueConfirmedOrder(envio, transaction);
  expect(models.SpeedboxPedido.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
    where: { environment: 'sandbox', envio_id: 31 },
    defaults: expect.objectContaining({ usuario_id: 7 }),
  }));
  expect(transaction.afterCommit).toHaveBeenCalledTimes(1);
});

it('does not schedule another submission for a linked or uncertain order', async () => {
  process.env.SPEEDBOX_ENABLED = 'true';
  const transaction = { afterCommit: jest.fn() };
  for (const estado of ['enviado', 'incierto', 'enviando', 'error']) {
    mapping.estado = estado;
    await service.queueConfirmedOrder(envio, transaction);
  }
  expect(transaction.afterCommit).not.toHaveBeenCalled();
});

it('dispatches the persisted confirmation through the normal idempotent sender', async () => {
  process.env.SPEEDBOX_ENABLED = 'true';
  models.SpeedboxPedido.findOne.mockResolvedValue(mapping);
  await service.dispatchConfirmedOrder(7, 31);
  expect(mapping.estado).toBe('enviado');
  expect(client.request).toHaveBeenCalledTimes(1);
});

it('contains provider failure after confirmation and retains the uncertain result', async () => {
  process.env.SPEEDBOX_ENABLED = 'true';
  models.SpeedboxPedido.findOne.mockResolvedValue(mapping);
  client.request.mockRejectedValueOnce(Object.assign(new Error('Timeout'), { uncertain: true }));
  await expect(service.dispatchConfirmedOrder(7, 31)).resolves.toBeUndefined();
  expect(mapping.estado).toBe('incierto');
  expect(require('../../utils/logger').logger.warn).toHaveBeenCalled();
});

it('does not dispatch an order without a persisted pending outbox entry', async () => {
  process.env.SPEEDBOX_ENABLED = 'true';
  models.SpeedboxPedido.findOne.mockResolvedValue(null);
  await service.dispatchConfirmedOrder(7, 31);
  expect(client.request).not.toHaveBeenCalled();
});

it('publishes only a configured HTTPS registration link without credentials', () => {
  expect(service.registrationUrl()).toBeNull();
  process.env.SPEEDBOX_REGISTRATION_URL = 'https://registration.example.test/register';
  expect(service.registrationUrl()).toBe('https://registration.example.test/register');
});

it.each(['javascript:alert(1)', 'http://example.test/register', 'https://user:password@example.test/register', 'https://example.test/register?api_key=private', 'not-a-url'])('does not publish unsafe registration URL %s', url => {
  process.env.SPEEDBOX_REGISTRATION_URL = url;
  expect(service.registrationUrl()).toBeNull();
});
