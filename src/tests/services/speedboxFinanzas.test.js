jest.mock('../../models', () => ({ sequelize: { transaction: jest.fn() },
  Envio: { findOne: jest.fn() }, SolicitudAbastecimiento: { findOne: jest.fn() }, SpeedboxEvento: { findOne: jest.fn() } }));
jest.mock('../../services/speedbox/service', () => ({ environment: () => 'sandbox' }));
jest.mock('../../services/speedbox/events', () => ({ normalize: jest.fn() }));
const m = require('../../models');
const { normalize } = require('../../services/speedbox/events');
const { conciliar, desglose } = require('../../services/speedbox/finanzas');
const input = { concepto: 'pago_proveedor', envio_id: null, solicitud_id: 4, nota: 'Comprobante cotejado' };
let event;
beforeEach(() => {
  jest.clearAllMocks();
  m.sequelize.transaction.mockImplementation(callback => callback({ LOCK: { UPDATE: 'UPDATE' } }));
  event = { event_key: 'id:evt-1', estado: 'procesado', payload: {}, source: 'webhook', update: jest.fn(async function(changes) { Object.assign(this, changes); return this; }) };
  m.SpeedboxEvento.findOne.mockResolvedValue(event);
  m.SolicitudAbastecimiento.findOne.mockResolvedValue({ id: 4 });
  m.Envio.findOne.mockResolvedValue({ id: 7 });
  normalize.mockReturnValue({ hasId: true, data: { direction: 'debit', amount: 50000, currency: 'PYG' } });
});
it('records audited evidence without updating payment or stock ledgers', async () => {
  const result = await conciliar(2, 3, input);
  expect(result.conciliacion).toMatchObject({ ...input, usuario_id: 2, amount: 50000, event_key: 'id:evt-1' });
  expect(m.SolicitudAbastecimiento.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 4, usuario_id: 2 } }));
  expect(event.update).toHaveBeenCalledTimes(1);
});
it('is idempotent and forbids silently overwriting a classification', async () => {
  await conciliar(2, 3, input);
  expect((await conciliar(2, 3, input)).duplicate).toBe(true);
  await expect(conciliar(2, 3, { ...input, nota: 'Otro motivo' })).rejects.toMatchObject({ status: 409 });
  expect(event.update).toHaveBeenCalledTimes(1);
});
it('filters wallet ownership and rejects unknown references', async () => {
  m.SpeedboxEvento.findOne.mockResolvedValueOnce(null);
  await expect(conciliar(9, 3, input)).rejects.toMatchObject({ status: 404 });
  expect(m.SpeedboxEvento.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3, usuario_id: 9, environment: 'sandbox', tipo: 'wallet.transaction' } }));
  m.SolicitudAbastecimiento.findOne.mockResolvedValueOnce(null);
  await expect(conciliar(2, 3, input)).rejects.toMatchObject({ status: 404 });
});
it('requires a remote event ID and valid direction', async () => {
  normalize.mockReturnValueOnce({ hasId: false, data: {} });
  await expect(conciliar(2, 3, input)).rejects.toMatchObject({ status: 409 });
  normalize.mockReturnValueOnce({ hasId: true, data: { direction: 'credit' } });
  await expect(conciliar(2, 3, input)).rejects.toMatchObject({ status: 400 });
  await expect(conciliar(2, 3, { ...input, concepto: 'cobro_cliente', envio_id: 7, solicitud_id: null })).rejects.toMatchObject({ status: 400 });
});
it('requires explicit concept, note and one appropriate reference', async () => {
  for (const invalid of [{ ...input, nota: '' }, { ...input, concepto: 'saldo' }, { ...input, solicitud_id: null },
    { ...input, envio_id: 7 }, { ...input, concepto: 'cobro_cliente' }]) {
    await expect(conciliar(2, 3, invalid)).rejects.toMatchObject({ status: 400 });
  }
  expect(event.update).not.toHaveBeenCalled();
});
it('does not infer collection or supplier payment from delivery or a wallet balance', () => {
  expect(desglose({ monto: 85000, costo_envio: 15000, costo_fulfillment: 4000, abastecimiento_costo: 50000,
    abastecimiento_estado: 'pendiente_pago', estado_financiero: 'pendiente_liquidacion', pago_anticipado: false }))
    .toMatchObject({ venta: 85000, envio_cliente: 15000, fulfillment: 4000, costo_abastecimiento: 50000,
      pago_proveedor: 'pendiente_pago', cobro_cliente: 'contra_entrega', estado_financiero: 'pendiente_liquidacion' });
});
