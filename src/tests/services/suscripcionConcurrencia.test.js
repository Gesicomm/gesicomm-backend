/**
 * Concurrencia al acreditar una suscripcion.
 *
 * Mismo escenario que el de pedidos: PagoPar reintenta el callback, y la
 * pantalla de resultado consulta el estado al abrirse. Dos avisos del mismo
 * pago pueden entrar a la vez.
 *
 * Lo que se rompe si no hay bloqueo de fila:
 *   - se emite un token_registro NUEVO que pisa al anterior. Si el primero
 *     ya se le mostro o mando a la persona, ese enlace queda muerto y no
 *     puede completar el alta;
 *   - el periodo (inicio/fin) se recalcula, corriendo el vencimiento.
 *
 * La comision de afiliado NO entra en esta lista: la protege un indice unico
 * sobre pago_suscripcion_id (verificado en la base), asi que el segundo
 * insert rebota solo.
 */
const SuscripcionService = require('../../services/suscripcion.service');
const { Suscripcion, Plan, PagoSuscripcion } = require('../../models');

jest.mock('../../models', () => ({
  sequelize: { transaction: jest.fn(fn => fn({ LOCK: { UPDATE: 'UPDATE' } })) },
  Suscripcion: { findByPk: jest.fn() },
  Plan: { findByPk: jest.fn() },
  PagoSuscripcion: { findByPk: jest.fn() },
  Usuario: { findOne: jest.fn() },
}));
jest.mock('../../services/parametros.service', () => ({
  obtenerVarios: jest.fn(), DEFINICIONES: [],
}));
jest.mock('../../services/afiliados.service', () => ({
  crearComisionPorPago: jest.fn(),
}));

function armarEscenario() {
  // Fila unica compartida, como en la base.
  const filaPago = {
    id: 9, suscripcion_id: 55, monto: 250000, estado: 'PENDING',
    update: jest.fn(function (cambios) { Object.assign(this, cambios); }),
  };
  const filaSusc = {
    id: 55, plan_id: 2, usuario_id: null, token_registro: null,
    update: jest.fn(function (cambios) { Object.assign(this, cambios); }),
  };
  PagoSuscripcion.findByPk.mockImplementation(async () => filaPago);
  Suscripcion.findByPk.mockImplementation(async () => filaSusc);
  Plan.findByPk.mockResolvedValue({ id: 2, periodicidad: 'mensual' });
  return { filaPago, filaSusc };
}

beforeEach(() => jest.clearAllMocks());

describe('acreditarPago — relectura con bloqueo', () => {
  it('relee el pago DENTRO de la transaccion y con FOR UPDATE', async () => {
    const { filaPago } = armarEscenario();
    await SuscripcionService.acreditarPago({ ...filaPago, update: filaPago.update }, {});

    expect(PagoSuscripcion.findByPk).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ lock: 'UPDATE', transaction: expect.anything() }),
    );
  });

  it('bloquea tambien la suscripcion antes de emitir el token', async () => {
    const { filaPago } = armarEscenario();
    await SuscripcionService.acreditarPago({ ...filaPago, update: filaPago.update }, {});

    expect(Suscripcion.findByPk).toHaveBeenCalledWith(
      55,
      expect.objectContaining({ lock: 'UPDATE' }),
    );
  });

  it('si la fila releida ya esta PAID, no emite otro token', async () => {
    const { filaPago, filaSusc } = armarEscenario();
    filaPago.estado = 'PAID';   // otro aviso gano la carrera

    // El caller todavia cree que esta PENDING.
    const r = await SuscripcionService.acreditarPago(
      { ...filaPago, estado: 'PENDING', update: filaPago.update },
      {},
    );

    expect(r.yaEstaba).toBe(true);
    expect(filaSusc.update).not.toHaveBeenCalled();
  });

  it('escribe sobre la fila releida, no sobre la copia del caller', async () => {
    const { filaPago } = armarEscenario();
    const copiaVieja = { ...filaPago, update: jest.fn() };

    await SuscripcionService.acreditarPago(copiaVieja, {});

    // El update va a la fila fresca; la copia del caller no se usa para escribir.
    expect(copiaVieja.update).not.toHaveBeenCalled();
    expect(filaPago.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'PAID' }),
      expect.anything(),
    );
  });
});
