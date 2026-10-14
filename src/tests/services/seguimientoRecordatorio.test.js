'use strict';

/**
 * Ciclo de vida del recordatorio de seguimiento.
 *
 * Regresión del 2026-10-11: VENCIDO se trataba como estado final. Un
 * recordatorio al que le llegaba la hora ya no se podía completar ni
 * cancelar (los dos endpoints buscaban solo PENDIENTE), no lo cerraba el
 * pedido al confirmarse y agendar uno nuevo lo dejaba al lado. El pedido
 * quedaba marcado "acción vencida" para siempre y el contador de la sidebar
 * solo podía crecer.
 *
 * No toca la base: los modelos se mockean. La de localhost:5434 es
 * PRODUCCIÓN detrás de un túnel.
 */

const { Op } = require('sequelize');

jest.mock('../../models', () => ({
  SpeedboxPedido: { findOne: jest.fn(async () => null) },
  sequelize: { transaction: (cb) => cb('TX') },
  Envio: { findOne: jest.fn() },
  SeguimientoRecordatorio: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn() },
}));
jest.mock('../../utils/historial', () => ({ registrarHistorial: jest.fn(async () => undefined) }));
jest.mock('../../services/queue/seguimientoQueue', () => ({ encolarRecordatorio: jest.fn(async () => undefined) }));

const { Envio, SeguimientoRecordatorio } = require('../../models');
const {
  elegirRecordatorioVigente,
  cancelarRecordatoriosPendientes,
} = require('../../services/seguimiento/seguimientoRecordatorio.service');
const controller = require('../../controllers/envioSeguimientoController');

/** Fila de Sequelize de mentira: lo mínimo que usa el controller. */
function fila(datos) {
  return {
    ...datos,
    update: jest.fn(async function (cambios) { Object.assign(this, cambios); return this; }),
  };
}

function respuesta() {
  const res = { codigo: 200, cuerpo: undefined };
  res.status = jest.fn((codigo) => { res.codigo = codigo; return res; });
  res.json = jest.fn((cuerpo) => { res.cuerpo = cuerpo; return res; });
  return res;
}

const peticion = (extra = {}) => ({
  usuario: { id: 7, rol: 'usuario' },
  params: { id: '50', recordatorioId: '900' },
  body: {},
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  Envio.findOne.mockResolvedValue({ id: 50 });
  SeguimientoRecordatorio.update.mockResolvedValue([0]);
});

describe('elegirRecordatorioVigente', () => {
  test('el PENDIENTE manda sobre un VENCIDO viejo, llegue en el orden que llegue', () => {
    const vencido = { id: 1, estado: 'VENCIDO' };
    const pendiente = { id: 2, estado: 'PENDIENTE' };

    expect(elegirRecordatorioVigente([vencido, pendiente])).toBe(pendiente);
    expect(elegirRecordatorioVigente([pendiente, vencido])).toBe(pendiente);
  });

  test('sin PENDIENTE, el VENCIDO más reciente', () => {
    const viejo = { id: 3, estado: 'VENCIDO' };
    const nuevo = { id: 8, estado: 'VENCIDO' };
    const cerrado = { id: 9, estado: 'COMPLETADO' };

    expect(elegirRecordatorioVigente([nuevo, cerrado, viejo])).toBe(nuevo);
  });

  test('sin nada abierto, el último que hubo; sin recordatorios, null', () => {
    const a = { id: 4, estado: 'CANCELADO' };
    const b = { id: 6, estado: 'COMPLETADO' };

    expect(elegirRecordatorioVigente([b, a])).toBe(b);
    expect(elegirRecordatorioVigente([])).toBeNull();
    expect(elegirRecordatorioVigente(undefined)).toBeNull();
  });
});

describe('cancelarRecordatoriosPendientes', () => {
  test('cierra también los VENCIDO cuando el pedido termina', async () => {
    await cancelarRecordatoriosPendientes(50);

    const [cambios, opciones] = SeguimientoRecordatorio.update.mock.calls[0];
    expect(cambios.estado).toBe('CANCELADO');
    expect(opciones.where.envio_id).toBe(50);
    expect(opciones.where.estado[Op.in]).toEqual(['PENDIENTE', 'VENCIDO']);
  });
});

describe('completar y cancelar un recordatorio vencido', () => {
  test('completar acepta un VENCIDO (antes respondía 404)', async () => {
    const vencido = fila({ id: 900, envio_id: 50, estado: 'VENCIDO' });
    SeguimientoRecordatorio.findAll.mockResolvedValue([vencido]);
    const res = respuesta();

    await controller.completarRecordatorio(peticion(), res, jest.fn());

    const [{ where }] = SeguimientoRecordatorio.findAll.mock.calls[0];
    expect(where.estado[Op.in]).toEqual(['PENDIENTE', 'VENCIDO']);
    expect(res.codigo).toBe(200);
    expect(vencido.estado).toBe('COMPLETADO');
    expect(vencido.completado_en).toBeInstanceOf(Date);
  });

  test('cancelar acepta un VENCIDO', async () => {
    const vencido = fila({ id: 900, envio_id: 50, estado: 'VENCIDO' });
    SeguimientoRecordatorio.findAll.mockResolvedValue([vencido]);
    const res = respuesta();

    await controller.cancelarRecordatorio(peticion(), res, jest.fn());

    expect(res.codigo).toBe(200);
    expect(vencido.estado).toBe('CANCELADO');
  });

  test('con un id que ya no está abierto, actúa sobre el vigente del pedido', async () => {
    const pendiente = fila({ id: 905, envio_id: 50, estado: 'PENDIENTE' });
    SeguimientoRecordatorio.findAll.mockResolvedValue([pendiente]);
    const res = respuesta();

    await controller.completarRecordatorio(peticion(), res, jest.fn());

    expect(pendiente.estado).toBe('COMPLETADO');
  });

  test('sin ninguno abierto responde 404', async () => {
    SeguimientoRecordatorio.findAll.mockResolvedValue([]);
    const res = respuesta();

    await controller.completarRecordatorio(peticion(), res, jest.fn());

    expect(res.codigo).toBe(404);
  });
});

describe('programarRecordatorio', () => {
  test('agendar el próximo contacto resuelve el que estaba vencido', async () => {
    SeguimientoRecordatorio.findOne.mockResolvedValue(null); // no hay PENDIENTE
    SeguimientoRecordatorio.create.mockResolvedValue(fila({ id: 901, envio_id: 50, estado: 'PENDIENTE', version: 1 }));
    const res = respuesta();

    await controller.programarRecordatorio(peticion({ body: { horas: 4 } }), res, jest.fn());

    expect(res.codigo).toBe(201);
    expect(SeguimientoRecordatorio.create).toHaveBeenCalledTimes(1);

    const [cambios, opciones] = SeguimientoRecordatorio.update.mock.calls[0];
    expect(cambios.estado).toBe('COMPLETADO');
    expect(opciones.where.envio_id).toBe(50);
    expect(opciones.where.estado).toBe('VENCIDO');
    expect(opciones.where.id[Op.ne]).toBe(901);
    expect(opciones.transaction).toBe('TX');
  });
});
