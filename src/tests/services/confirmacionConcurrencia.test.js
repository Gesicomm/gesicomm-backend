/**
 * Proteccion contra avisos concurrentes al acreditar un pago.
 *
 * ALCANCE DE ESTE TEST — importante: la exclusion real la da Postgres con
 * SELECT ... FOR UPDATE. Un mock de jest NO emula bloqueos: ejecuta las dos
 * corrutinas entrelazadas y las deja pasar a las dos. Por eso aca NO se
 * afirma "el stock se descuenta una sola vez" (seria verde por casualidad de
 * timing, no por la proteccion).
 *
 * Lo que si se fija, y es un guard real contra regresiones:
 *   - que la fila se RELEA dentro de la transaccion, no que se confie en el
 *     objeto en memoria que trajo el caller;
 *   - que esa relectura pida `lock: t.LOCK.UPDATE`;
 *   - que si la fila releida ya esta pagada, se corte sin repetir efectos.
 *
 * La verificacion bajo concurrencia real necesita un test de integracion
 * contra Postgres con dos conexiones. No esta hecho.
 */
const { confirmarPedidoPagado } = require('../../services/payments/confirmacionPago');
const { descontarStockYSnapshot } = require('../../controllers/envioController');
const { PaymentTransaction, Envio } = require('../../models');

jest.mock('../../controllers/envioController', () => ({
  descontarStockYSnapshot: jest.fn(),
  calcularAbastecimientoDesdeItems: jest.fn().mockResolvedValue({
    requiere: false, costo: 0, estado: 'no_requiere',
  }),
}));
jest.mock('../../utils/historial', () => ({ registrarHistorial: jest.fn() }));
jest.mock('../../services/speedbox/service', () => ({ queueConfirmedOrder: jest.fn() }));
jest.mock('../../models', () => ({
  // Transacciones reales serializadas: se ejecutan tal cual, como haria
  // Postgres si NO hubiera lock de fila.
  sequelize: { transaction: jest.fn(fn => fn({ LOCK: { UPDATE: 'UPDATE' } })) },
  PaymentTransaction: { findByPk: jest.fn() },
  Envio: { findByPk: jest.fn() },
}));

// Estado compartido: simula la fila unica en la base.
function armarEscenario() {
  const filaTrx = { id: 7, status: 'PENDING', save: jest.fn() };
  const filaEnvio = {
    id: 42, usuario_id: 3, estado: 'Pendiente', stock_descontado: false,
    items: [{ id: 1, producto_id: 9, cantidad: 2 }],
    save: jest.fn(),
  };
  // findByPk devuelve SIEMPRE la misma fila, como la base.
  PaymentTransaction.findByPk.mockImplementation(async () => filaTrx);
  Envio.findByPk.mockImplementation(async () => filaEnvio);
  return { filaTrx, filaEnvio };
}

beforeEach(() => jest.clearAllMocks());

describe('confirmarPedidoPagado — relectura con bloqueo', () => {
  it('relee la transaccion DENTRO de la transaccion y con FOR UPDATE', async () => {
    const { filaTrx, filaEnvio } = armarEscenario();
    await confirmarPedidoPagado(filaEnvio, { ...filaTrx, save: filaTrx.save });

    expect(PaymentTransaction.findByPk).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ lock: 'UPDATE', transaction: expect.anything() }),
    );
  });

  it('bloquea tambien la fila del Envio', async () => {
    const { filaTrx, filaEnvio } = armarEscenario();
    await confirmarPedidoPagado(filaEnvio, { ...filaTrx, save: filaTrx.save });

    expect(Envio.findByPk).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ lock: 'UPDATE' }),
    );
  });

  it('si la fila releida ya esta PAID, no descuenta stock', async () => {
    const { filaTrx, filaEnvio } = armarEscenario();
    filaTrx.status = 'PAID';   // otro aviso gano la carrera

    // El caller todavia cree que esta PENDING (su copia es vieja).
    const r = await confirmarPedidoPagado(filaEnvio, { ...filaTrx, status: 'PENDING', save: filaTrx.save });

    expect(r).toBe('ya_pagado');
    expect(descontarStockYSnapshot).not.toHaveBeenCalled();
    expect(require('../../services/speedbox/service').queueConfirmedOrder).not.toHaveBeenCalled();
  });

  it('NO bloquea el Envio con include: FOR UPDATE sobre un LEFT JOIN falla en Postgres', async () => {
    const { filaTrx, filaEnvio } = armarEscenario();
    await confirmarPedidoPagado(filaEnvio, { ...filaTrx, save: filaTrx.save });

    const opciones = Envio.findByPk.mock.calls.at(-1)[1];
    expect(opciones.include).toBeUndefined();
  });

  it('queues Speedbox inside the same transaction after paid order confirmation', async () => {
    const { filaTrx, filaEnvio } = armarEscenario();
    await confirmarPedidoPagado(filaEnvio, { ...filaTrx });
    expect(require('../../services/speedbox/service').queueConfirmedOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42, estado: 'Confirmado', stock_descontado: true }),
      expect.objectContaining({ LOCK: { UPDATE: 'UPDATE' } }),
    );
  });
});
