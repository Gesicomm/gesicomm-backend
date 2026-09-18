/**
 * Cron de reconciliación: segunda línea de defensa si se perdió el webhook
 * de PagoPar. Dos cosas a probar, aparte de que reconcilie:
 *   - respeta la ventana de gracia (no compite con el webhook normal);
 *   - es seguro con varias instancias del backend corriendo el mismo cron
 *     (pg_try_advisory_xact_lock: si otra instancia ya tiene el lock, esta
 *     no toca nada).
 */
jest.mock('../../models', () => ({
  sequelize: {
    transaction: jest.fn(fn => fn('TRX')),
    query: jest.fn(),
  },
  PagoSuscripcion: { findAll: jest.fn() },
}));
jest.mock('../../services/suscripcion.service', () => ({
  consultarYReconciliarPagoPorHash: jest.fn(),
}));

const { sequelize, PagoSuscripcion } = require('../../models');
const SuscripcionService = require('../../services/suscripcion.service');
const { reconciliarPagosPendientes } = require('../../services/cron/reconciliacionSuscripciones.job');

beforeEach(() => jest.clearAllMocks());

describe('Cron de reconciliación de suscripciones', () => {
  it('si no consigue el advisory lock, no toca nada (otra instancia ya está corriendo el barrido)', async () => {
    sequelize.query.mockResolvedValue([[{ lock_obtenido: false }]]);

    await reconciliarPagosPendientes();

    expect(PagoSuscripcion.findAll).not.toHaveBeenCalled();
    expect(SuscripcionService.consultarYReconciliarPagoPorHash).not.toHaveBeenCalled();
  });

  it('con el lock obtenido, reconcilia cada PENDING encontrado', async () => {
    sequelize.query.mockResolvedValue([[{ lock_obtenido: true }]]);
    PagoSuscripcion.findAll.mockResolvedValue([
      { hash_pedido: 'hash1' },
      { hash_pedido: 'hash2' },
    ]);

    await reconciliarPagosPendientes();

    expect(SuscripcionService.consultarYReconciliarPagoPorHash).toHaveBeenCalledWith('hash1', expect.any(Object));
    expect(SuscripcionService.consultarYReconciliarPagoPorHash).toHaveBeenCalledWith('hash2', expect.any(Object));
  });

  it('solo busca PENDING con hash y fuera de la ventana de gracia', async () => {
    sequelize.query.mockResolvedValue([[{ lock_obtenido: true }]]);
    PagoSuscripcion.findAll.mockResolvedValue([]);

    await reconciliarPagosPendientes();

    const filtro = PagoSuscripcion.findAll.mock.calls[0][0].where;
    expect(filtro.estado).toBe('PENDING');
    expect(filtro.hash_pedido).toBeDefined();
    expect(filtro.created_at).toBeDefined();
  });

  it('un pago que falla no frena el resto del lote', async () => {
    sequelize.query.mockResolvedValue([[{ lock_obtenido: true }]]);
    PagoSuscripcion.findAll.mockResolvedValue([
      { hash_pedido: 'malo' },
      { hash_pedido: 'bueno' },
    ]);
    SuscripcionService.consultarYReconciliarPagoPorHash
      .mockRejectedValueOnce(new Error('PagoPar no responde'))
      .mockResolvedValueOnce({});

    await reconciliarPagosPendientes();

    expect(SuscripcionService.consultarYReconciliarPagoPorHash).toHaveBeenCalledTimes(2);
  });
});
