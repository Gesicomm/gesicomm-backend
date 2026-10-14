jest.mock('../../models', () => ({
  sequelize: { transaction: jest.fn(), query: jest.fn() },
  Tienda: { findOne: jest.fn() }, Courier: { findOne: jest.fn() }, Envio: { findOne: jest.fn() },
  EnvioItem: { findAll: jest.fn() }, EnvioItemComponente: { findAll: jest.fn() },
  Producto: { findByPk: jest.fn() }, ProductoVariante: { findAll: jest.fn(), findOne: jest.fn() },
  Deposito: { findOne: jest.fn() }, SolicitudAbastecimiento: { findOne: jest.fn() },
  SpeedboxTienda: { findOne: jest.fn(), findAll: jest.fn(), findOrCreate: jest.fn() }, SpeedboxPedido: { findOrCreate: jest.fn(), findOne: jest.fn() }, SpeedboxEvento: {},
}));
jest.mock('../../services/speedbox/client', () => ({ configuration: jest.fn(() => ({ environment: 'sandbox' })), request: jest.fn(), remoteId: value => String(value), redact: value => value }));
jest.mock('../../services/speedbox/payload', () => ({ buildOrder: jest.fn(), buildSupplyOrder: jest.fn() }));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn() } }));
const models = require('../../models');
const client = require('../../services/speedbox/client');
const payload = require('../../services/speedbox/payload');
const service = require('../../services/speedbox/service');
function instance(value) { return { ...value, update: jest.fn(async function update(changes) { Object.assign(this, changes); return this; }) }; }
let mapping, envio, connection;
const originalEnabled = process.env.SPEEDBOX_ENABLED;
const originalRegistration = process.env.SPEEDBOX_REGISTRATION_URL;
const originalWebhookToken = process.env.SPEEDBOX_WEBHOOK_TOKEN;
beforeEach(() => {
  jest.clearAllMocks(); process.env.SPEEDBOX_ENVIRONMENT = 'sandbox';
  process.env.SPEEDBOX_ENABLED = 'false';
  delete process.env.SPEEDBOX_REGISTRATION_URL;
  delete process.env.SPEEDBOX_WEBHOOK_TOKEN;
  models.sequelize.transaction.mockImplementation(callback => callback({ LOCK: { UPDATE: 'UPDATE' } }));
  connection = instance({ environment: 'sandbox', tienda_id: '54', courier_id: 2, activo: true, public_key: 'stored_public', private_key: 'stored_secret' });
  envio = instance({ id: 31, usuario_id: 7, courier_id: 2, estado: 'Confirmado', stock_descontado: true });
  mapping = instance({ external_order_id: 'GESICOMM-sandbox-7-31', estado: 'pendiente', intentos: 0 });
  models.SpeedboxTienda.findOne.mockResolvedValue(connection);
  models.SpeedboxTienda.findAll.mockResolvedValue([connection]);
  models.SpeedboxTienda.findOrCreate.mockResolvedValue([connection, false]);
  models.Envio.findOne.mockResolvedValue(envio);
  models.SpeedboxPedido.findOne.mockResolvedValue(null);
  models.SpeedboxPedido.findOrCreate.mockResolvedValue([mapping, true]);
  models.SolicitudAbastecimiento.findOne.mockResolvedValue(instance({
    id: 44, usuario_id: 7, producto_id: 9, variante_id: null, cantidad: 2, tipo_logistica: 'PROPIA',
    deposito_destino_id: 6, costo_producto: 170000, created_at: new Date('2026-10-13T12:00:00Z'),
  }));
  models.Producto.findByPk.mockResolvedValue({ id: 9, sku: 'RAHA-9', nombre: 'Producto RAHA', creado_por: 1 });
  models.ProductoVariante.findOne.mockResolvedValue(null);
  models.Deposito.findOne.mockResolvedValue({ id: 6, nombre: 'Depósito Luque', direccion: 'Av. Test 123', ciudad: 'Luque', departamento: 'Central', persona_contacto: 'Martin', telefono_contacto: '0981000000' });
  models.EnvioItemComponente.findAll.mockResolvedValue([{ producto: { id: 9, creado_por: 1 } }]);
  models.EnvioItem.findAll.mockResolvedValue([{ componentes_vendidos: [] }]);
  models.Tienda.findOne.mockResolvedValue({ nombre: 'Mi tienda' });
  models.Courier.findOne.mockResolvedValue({ id: 2, activo: true });
  payload.buildOrder.mockReturnValue({ external_order_id: mapping.external_order_id, total_price: 85000 });
  payload.buildSupplyOrder.mockImplementation((solicitud, _tienda, conn) => ({
    external_order_id: `GESICOMM-ABAST-${conn.environment}-${solicitud.usuario_id}-${solicitud.id}`,
    total_price: 170000,
  }));
  client.request.mockResolvedValue({ ok: true, order: { external_order_id: mapping.external_order_id, order_id: '900000000123456', status: 'pendiente_confirmacion' } });
});
afterEach(() => {
  if (originalEnabled === undefined) delete process.env.SPEEDBOX_ENABLED;
  else process.env.SPEEDBOX_ENABLED = originalEnabled;
  if (originalRegistration === undefined) delete process.env.SPEEDBOX_REGISTRATION_URL;
  else process.env.SPEEDBOX_REGISTRATION_URL = originalRegistration;
  if (originalWebhookToken === undefined) delete process.env.SPEEDBOX_WEBHOOK_TOKEN;
  else process.env.SPEEDBOX_WEBHOOK_TOKEN = originalWebhookToken;
});
it('keeps the remote ID and records a successful order', async () => {
  expect(await service.sendOrder(7, 31)).toMatchObject({ estado: 'enviado', order_id: '900000000123456' });
  expect(models.Envio.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 31, usuario_id: 7 } }));
  expect(client.request).toHaveBeenCalledWith('order', expect.objectContaining({
    credentials: { environment: 'sandbox', apiKey: 'stored_public', secret: 'stored_secret' },
  }));
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
it('rejects local-only orders because RAHA manages its own catalog logistics', async () => {
  models.EnvioItemComponente.findAll.mockResolvedValue([]);
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
it('uses the Gesicom store assigned to the order when building the RAHA payload', async () => {
  envio.tienda_id = 22;
  await service.sendOrder(7, 31);
  expect(models.Tienda.findOne).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 22, usuario_id: 7 },
  }));
  expect(payload.buildOrder).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ nombre: 'Mi tienda' }),
    expect.anything(),
    expect.any(Map),
    { onlyExternalProducts: true, usuarioId: 7 },
  );
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
it('does not allow manual logistics state changes on a remote order', async () => {
  models.SpeedboxPedido.findOne.mockResolvedValue(mapping);
  await expect(service.assertCanChange(envio, { estado: 'Preparado' }, {})).rejects.toMatchObject({ status: 409 });
});
it('allows payment edits and the same courier on a remote order', async () => {
  models.SpeedboxPedido.findOne.mockResolvedValue(mapping);
  await expect(service.assertCanChange(envio, { courier_id: 2 }, {})).resolves.toBeUndefined();
  await expect(service.assertCanChange(envio, { monto: 85000 }, {})).resolves.toBeUndefined();
});

it('verifies the sandbox spec with pasted credentials and stores them for automation', async () => {
  await expect(service.verifySpec(7, { public_key: ' sbx_public ', private_key: ' private_secret ' })).resolves.toEqual({ ok: true });
  expect(client.request).toHaveBeenCalledWith('spec', { credentials: { environment: 'sandbox', apiKey: 'sbx_public', secret: 'private_secret' } });
  expect(models.SpeedboxTienda.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
    where: { usuario_id: 7, environment: 'sandbox' },
  }));
  expect(connection.update).toHaveBeenCalledWith(expect.objectContaining({
    spec_verified_at: expect.any(Date),
    public_key: 'sbx_public',
    private_key: 'private_secret',
    activo: true,
    enabled_at: expect.any(Date),
  }));
});

it('links RAHA using the active Gesicom store from the session', async () => {
  connection.tienda_id = null;
  models.Tienda.findOne.mockResolvedValueOnce({
    id: 22,
    nombre: 'sommix',
    subdominio: 'sommix',
    dominio_propio_verificado: false,
    dominio_propio_habilitado: false,
  });
  client.request.mockResolvedValueOnce({ ok: true, tienda_id: '65' });

  const result = await service.registerStore(7, { public_key: 'sbx_public', private_key: 'private_secret' }, { tiendaId: 22 });
  expect(result).toMatchObject({ tienda_id: '65', activo: true, has_private_key: true });
  expect(result).not.toHaveProperty('private_key');

  expect(models.Tienda.findOne).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 22, usuario_id: 7 },
  }));
  expect(client.request).toHaveBeenCalledWith('store', expect.objectContaining({
    method: 'POST',
    body: expect.objectContaining({
      external_store_id: 'GESICOMM-sandbox-7',
      store_name: 'sommix',
      domain: expect.stringContaining('sommix.'),
    }),
  }));
});

it('saves RAHA credentials without requiring a linked store yet', async () => {
  connection.tienda_id = null;
  const result = await service.configure(7, { activo: false, public_key: 'new_public', private_key: 'new_secret' });
  expect(models.SpeedboxTienda.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
    where: { usuario_id: 7, environment: 'sandbox' },
  }));
  expect(connection.update).toHaveBeenCalledWith(expect.objectContaining({
    public_key: 'new_public',
    private_key: 'new_secret',
    activo: false,
  }), expect.anything());
  expect(result).toMatchObject({ public_key: 'new_public', has_private_key: true, activo: false });
  expect(result).not.toHaveProperty('private_key');
});

it('requires stored RAHA credentials before activation', async () => {
  connection.public_key = null;
  connection.private_key = null;
  process.env.SPEEDBOX_WEBHOOK_TOKEN = '12345678901234567890123456789012';
  await expect(service.configure(7, { activo: true })).rejects.toMatchObject({ status: 409 });
  expect(connection.update).not.toHaveBeenCalled();
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
  expect(connection.update).toHaveBeenCalledWith(expect.objectContaining({
    order_verified_at: expect.any(Date),
    public_key: 'sbx_public',
    private_key: 'private_secret',
    activo: true,
    enabled_at: expect.any(Date),
  }));
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

it('queues manual RAHA confirmations even when background automation is disabled or paused', async () => {
  connection.activo = false;
  const transaction = { afterCommit: jest.fn() };
  await service.queueConfirmedOrder(envio, transaction);
  expect(models.SpeedboxPedido.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
    where: { environment: 'sandbox', envio_id: 31 },
  }));
  expect(transaction.afterCommit).toHaveBeenCalledTimes(1);
});

it('does not queue local-only orders or an unlinked store', async () => {
  process.env.SPEEDBOX_ENABLED = 'true'; models.EnvioItemComponente.findAll.mockResolvedValue([]);
  expect(await service.queueConfirmedOrder(envio, {})).toBeNull();
  models.EnvioItemComponente.findAll.mockResolvedValue([{ producto: { id: 9, creado_por: 1 } }]);
  connection.tienda_id = null;
  expect(await service.queueConfirmedOrder(envio, {})).toBeNull();
  expect(models.SpeedboxPedido.findOrCreate).not.toHaveBeenCalled();
});

it('does not queue a RAHA product when it was reserved from a local deposit', async () => {
  process.env.SPEEDBOX_ENABLED = 'true';
  models.EnvioItemComponente.findAll.mockResolvedValue([{
    producto: { id: 9, creado_por: 1 },
    origen_centro_id: 22,
    cantidad_desde_centro: 1,
  }]);
  expect(await service.queueConfirmedOrder(envio, { afterCommit: jest.fn() })).toBeNull();
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

it('uses production credentials for real RAHA orders when the store has both environments', async () => {
  process.env.SPEEDBOX_ENABLED = 'true';
  const production = instance({
    environment: 'production',
    tienda_id: 'prod-54',
    courier_id: null,
    activo: true,
    public_key: 'prod_public',
    private_key: 'prod_secret',
  });
  models.SpeedboxTienda.findAll.mockResolvedValue([connection, production]);
  const transaction = { afterCommit: jest.fn() };
  await service.queueConfirmedOrder(envio, transaction);
  expect(models.SpeedboxPedido.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
    where: { environment: 'production', envio_id: 31 },
    defaults: expect.objectContaining({ external_order_id: 'GESICOMM-production-7-31' }),
  }));
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

it('queues a deposito supply request and sends it to RAHA with stored credentials', async () => {
  const solicitud = instance({
    id: 44,
    usuario_id: 7,
    tipo_logistica: 'PROPIA',
    deposito_destino_id: 6,
  });
  const transaction = { afterCommit: jest.fn() };
  await service.queueSupplyRequest(solicitud, transaction);
  expect(models.SpeedboxPedido.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
    where: { environment: 'sandbox', solicitud_abastecimiento_id: 44 },
    defaults: expect.objectContaining({
      envio_id: null,
      external_order_id: 'GESICOMM-ABAST-sandbox-7-44',
    }),
  }));
  expect(transaction.afterCommit).toHaveBeenCalledTimes(1);

  mapping = instance({ external_order_id: 'GESICOMM-ABAST-sandbox-7-44', estado: 'pendiente', intentos: 0 });
  models.SpeedboxPedido.findOrCreate.mockResolvedValueOnce([mapping, false]);
  client.request.mockResolvedValueOnce({ ok: true, order: { external_order_id: 'GESICOMM-ABAST-sandbox-7-44', order_id: '900000000123999', status: 'pendiente_confirmacion' } });
  await expect(service.sendSupplyRequest(7, 44)).resolves.toMatchObject({ estado: 'enviado', order_id: '900000000123999' });
  expect(payload.buildSupplyOrder).toHaveBeenCalledWith(expect.objectContaining({ id: 44 }), expect.anything(), expect.anything(), expect.objectContaining({
    producto: expect.objectContaining({ sku: 'RAHA-9' }),
    deposito: expect.objectContaining({ id: 6 }),
  }));
  expect(client.request).toHaveBeenCalledWith('order', expect.objectContaining({
    credentials: { environment: 'sandbox', apiKey: 'stored_public', secret: 'stored_secret' },
    body: expect.objectContaining({ external_order_id: 'GESICOMM-ABAST-sandbox-7-44' }),
  }));
});

it('allows manual deposito supply requests when automatic RAHA shipping is paused', async () => {
  connection.activo = false;
  const solicitud = instance({
    id: 44,
    usuario_id: 7,
    tipo_logistica: 'PROPIA',
    deposito_destino_id: 6,
  });
  const transaction = { afterCommit: jest.fn() };
  await service.queueSupplyRequest(solicitud, transaction);
  expect(models.SpeedboxPedido.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
    where: { environment: 'sandbox', solicitud_abastecimiento_id: 44 },
  }));
  expect(transaction.afterCommit).toHaveBeenCalledTimes(1);

  mapping = instance({ external_order_id: 'GESICOMM-ABAST-sandbox-7-44', estado: 'pendiente', intentos: 0 });
  models.SpeedboxPedido.findOrCreate.mockResolvedValueOnce([mapping, false]);
  client.request.mockResolvedValueOnce({ ok: true, order: { external_order_id: 'GESICOMM-ABAST-sandbox-7-44', order_id: '900000000123999', status: 'pendiente_confirmacion' } });
  await expect(service.sendSupplyRequest(7, 44)).resolves.toMatchObject({ estado: 'enviado', order_id: '900000000123999' });
  expect(client.request).toHaveBeenCalledWith('order', expect.objectContaining({
    credentials: { environment: 'sandbox', apiKey: 'stored_public', secret: 'stored_secret' },
  }));
});

it('uses production credentials for manual supply when production keys are available', async () => {
  const production = instance({
    environment: 'production',
    tienda_id: 'prod-54',
    courier_id: null,
    activo: false,
    public_key: 'prod_public',
    private_key: 'prod_secret',
  });
  models.SpeedboxTienda.findAll.mockResolvedValue([connection, production]);
  const solicitud = instance({
    id: 44,
    usuario_id: 7,
    tipo_logistica: 'PROPIA',
    deposito_destino_id: 6,
  });
  const transaction = { afterCommit: jest.fn() };
  await service.queueSupplyRequest(solicitud, transaction);
  expect(models.SpeedboxPedido.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
    where: { environment: 'production', solicitud_abastecimiento_id: 44 },
    defaults: expect.objectContaining({ external_order_id: 'GESICOMM-ABAST-production-7-44' }),
  }));
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

it('builds a copyable webhook URL from the request host when no public base env exists', () => {
  process.env.SPEEDBOX_WEBHOOK_TOKEN = '12345678901234567890123456789012';
  expect(service.webhookUrl({ publicBaseUrl: 'https://api.example.test' }))
    .toBe('https://api.example.test/api/webhooks/speedbox?environment=sandbox&token=12345678901234567890123456789012');
});

it.each(['javascript:alert(1)', 'http://example.test/register', 'https://user:password@example.test/register', 'https://example.test/register?api_key=private', 'not-a-url'])('does not publish unsafe registration URL %s', url => {
  process.env.SPEEDBOX_REGISTRATION_URL = url;
  expect(service.registrationUrl()).toBeNull();
});
