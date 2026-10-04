jest.mock('../../models', () => ({
  sequelize: { transaction: jest.fn(), query: jest.fn() },
  Envio: { findOne: jest.fn() }, EnvioItem: { findAll: jest.fn() },
  SpeedboxPedido: { findOne: jest.fn() }, SpeedboxTienda: { findOne: jest.fn(), findAll: jest.fn(), update: jest.fn() },
  SpeedboxEvento: { findOrCreate: jest.fn(), findAll: jest.fn() }, EnvioHistorial: { create: jest.fn() },
}));
jest.mock('../../services/speedbox/service', () => ({ environment: () => 'sandbox' }));
jest.mock('../../controllers/envioController', () => ({ moverAReservadoATransito: jest.fn(), consumirTransito: jest.fn() }));
jest.mock('../../services/speedbox/client', () => {
  const actual = jest.requireActual('../../services/speedbox/client');
  return { ...actual, request: jest.fn(), configuration: jest.fn() };
});
const models = require('../../models');
const inventory = require('../../controllers/envioController');
const client = require('../../services/speedbox/client');
const events = require('../../services/speedbox/events');

function instance(value) { return { ...value, update: jest.fn(async function update(changes) { Object.assign(this, changes); return this; }) }; }
function webhook(status, id = 'evt-1', at = '2026-10-02T12:00:00Z') {
  return { event: 'shipment.status_changed', event_id: id, occurred_at: at, data: { order_id: '900000000123456', tienda_id: 54, status } };
}
let envio, mapping, rows;
beforeEach(() => {
  jest.clearAllMocks(); rows = new Map();
  models.sequelize.transaction.mockImplementation(callback => callback({ LOCK: { UPDATE: 'UPDATE' } }));
  models.sequelize.query.mockResolvedValue([[{ acquired: true }]]);
  models.SpeedboxEvento.findOrCreate.mockImplementation(async ({ where, defaults }) => {
    if (rows.has(where.event_key)) return [rows.get(where.event_key), false];
    const record = instance({ ...defaults, ...where, estado: 'pendiente' }); rows.set(where.event_key, record); return [record, true];
  });
  mapping = instance({ usuario_id: 7, envio_id: 31, status: 'pendiente_confirmacion', status_at: null });
  envio = instance({ id: 31, usuario_id: 7, estado: 'Confirmado', stock_descontado: true, stock_liberado: false, stock_despachado: false, metodo_pago_id: 1 });
  models.SpeedboxPedido.findOne.mockResolvedValue(mapping);
  models.Envio.findOne.mockResolvedValue(envio);
  models.EnvioItem.findAll.mockResolvedValue([{ id: 1 }]);
  models.SpeedboxTienda.findOne.mockResolvedValue(instance({ usuario_id: 7, tienda_id: '54' }));
  models.SpeedboxTienda.findAll.mockResolvedValue([instance({ id: 1, activo: true, since_at: '2026-10-01T00:00:00Z' })]);
});

it('does not move stock twice when a webhook is retried', async () => {
  await events.ingest(webhook('en_camino'), 'webhook');
  expect(await events.ingest(webhook('en_camino'), 'webhook')).toMatchObject({ duplicate: true });
  expect(envio.estado).toBe('Despachado');
  expect(inventory.moverAReservadoATransito).toHaveBeenCalledTimes(1);
});
it('consumes transit once even when the same delivery arrives with different IDs and channels', async () => {
  await events.ingest(webhook('entregado'), 'webhook');
  await events.ingest({ type: 'shipment.status_changed', order_id: '900000000123456', payload: { status: 'entregado' } }, 'updates');
  expect(envio.estado).toBe('Entregado');
  expect(inventory.moverAReservadoATransito).toHaveBeenCalledTimes(1);
  expect(inventory.consumirTransito).toHaveBeenCalledTimes(1);
});
it('ignores an older event and never regresses a delivered order', async () => {
  await events.ingest(webhook('entregado'), 'webhook');
  expect(await events.ingest(webhook('cargado', 'old', '2026-10-01T00:00:00Z'), 'webhook')).toMatchObject({ estado: 'ignorado' });
  expect(envio.estado).toBe('Entregado');
  expect(mapping.status).toBe('entregado');
});
it('flags returns for physical review without adding inventory', async () => {
  envio.estado = 'Despachado'; envio.stock_despachado = true;
  expect(await events.ingest(webhook('devuelto'), 'webhook')).toMatchObject({ estado: 'revision', status: 'devuelto' });
  expect(envio.estado).toBe('Despachado');
  expect(envio.estado_logistico).toBe('Devuelto');
  expect(inventory.consumirTransito).not.toHaveBeenCalled();
});
it('records physical delivery but flags missing final payment data', async () => {
  envio.metodo_pago_id = null;
  expect(await events.ingest(webhook('entregado'), 'webhook')).toMatchObject({ estado: 'revision' });
  expect(envio.estado).toBe('Entregado');
  expect(envio.monto).toBeUndefined();
});
it('can inspect a return even when the dispatch event was missed', async () => {
  await events.ingest(webhook('devuelto'), 'webhook');
  expect(envio.estado).toBe('Despachado');
  expect(envio.estado_logistico).toBe('Devuelto');
  expect(inventory.moverAReservadoATransito).toHaveBeenCalledTimes(1);
  expect(inventory.consumirTransito).not.toHaveBeenCalled();
});
it('stores an unknown order for later reconciliation', async () => {
  models.SpeedboxPedido.findOne.mockResolvedValueOnce(null);
  expect(await events.ingest(webhook('en_camino'), 'webhook')).toMatchObject({ estado: 'pendiente' });
  await events.ingest(webhook('en_camino'), 'webhook');
  expect(envio.estado).toBe('Despachado');
});
it('rejects a webhook that belongs to another store', async () => {
  const event = webhook('en_camino'); event.data.tienda_id = 55;
  await expect(events.ingest(event, 'webhook')).rejects.toMatchObject({ status: 409 });
  expect(inventory.moverAReservadoATransito).not.toHaveBeenCalled();
});
it('deduplicates ID-bearing wallet transactions across webhook and updates', async () => {
  const data = { tienda_id: 54, direction: 'credit', amount: 85000, currency: 'PYG' };
  await events.ingest({ event: 'wallet.transaction', event_id: 'wallet-1', data }, 'webhook');
  expect(await events.ingest({ type: 'wallet.transaction', event_id: 'wallet-1', tienda_id: 54, payload: data }, 'updates')).toMatchObject({ duplicate: true });
  expect(rows.size).toBe(1);
  expect(models.Envio.findOne).not.toHaveBeenCalled();
});
it('retains wallet observations without an ID for review and does not calculate a balance', async () => {
  expect(await events.ingest({ type: 'wallet.transaction', tienda_id: 54, payload: { direction: 'credit', amount: 85000, currency: 'PYG' } }, 'updates')).toMatchObject({ estado: 'revision' });
});
it('rejects unsupported shipment states', () => {
  expect(() => events.normalize(webhook('cancelado'), 'webhook')).toThrow('Estado');
});
it('does not advance the polling cursor when an event fails', async () => {
  client.request.mockResolvedValue({ events: [webhook('invalid')], next_since_at: '2026-10-02T13:00:00Z' });
  await expect(events.pollUpdates()).rejects.toThrow('Estado');
  expect(models.SpeedboxTienda.update).not.toHaveBeenCalled();
});
it('persists next_since_at after processing the full page', async () => {
  client.request.mockResolvedValue({ events: [webhook('cargado')], next_since_at: '2026-10-02T13:00:00Z' });
  expect(await events.pollUpdates()).toMatchObject({ events: 1 });
  expect(models.SpeedboxTienda.update).toHaveBeenCalledWith(expect.objectContaining({ since_at: '2026-10-02T13:00:00Z' }), expect.anything());
});
