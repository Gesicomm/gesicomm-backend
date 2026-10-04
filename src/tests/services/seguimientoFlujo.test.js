'use strict';

/**
 * Flujos de WhatsApp: el proceso y sus fases ordenadas.
 *
 * Lo que se verifica acá es la regla central del módulo: una fase NO se
 * consume. Haber abierto la Fase 1 no la bloquea ni avanza nada — se puede
 * reenviar cuantas veces haga falta, y "cuántas veces" / "cuándo fue la
 * última" se derivan del historial de contactos, no de ningún puntero de
 * fase actual guardado en el pedido.
 *
 * Además se cubre que borrar una fase o un flujo que ya tiene envíos NO
 * destruye el historial: se desactiva.
 *
 * No toca la base: los modelos se mockean. La de localhost:5434 es
 * PRODUCCIÓN detrás de un túnel.
 */

jest.mock('../../models', () => ({
  sequelize: { transaction: (cb) => cb('TX') },
  WhatsappFlujo: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), destroy: jest.fn() },
  WhatsappFlujoFase: { findAll: jest.fn(), create: jest.fn(), update: jest.fn() },
  SeguimientoEtiqueta: { findAll: jest.fn() },
  SeguimientoContacto: { findAll: jest.fn() },
}));

const {
  WhatsappFlujo, WhatsappFlujoFase, SeguimientoEtiqueta, SeguimientoContacto,
} = require('../../models');
const flujoService = require('../../services/seguimiento/flujo.service');

/** Fila de Sequelize de mentira: lo mínimo que usa el service. */
function fila(datos) {
  return {
    ...datos,
    update: jest.fn(async function (cambios) { Object.assign(this, cambios); return this; }),
    destroy: jest.fn(async () => undefined),
    toJSON() {
      const { update, destroy, toJSON, ...plano } = this;
      return JSON.parse(JSON.stringify(plano));
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  SeguimientoEtiqueta.findAll.mockResolvedValue([]);
  SeguimientoContacto.findAll.mockResolvedValue([]);
  WhatsappFlujoFase.findAll.mockResolvedValue([]);
});

const CTX = { usuarioId: 7, esAdmin: false };

describe('estadoFlujosDelPedido', () => {
  const flujoConTresFases = () => fila({
    id: 10,
    nombre: 'Confirmación de pedido',
    activo: true,
    fases: [
      { id: 101, nombre: 'Primer contacto', orden: 1, espera_sugerida_minutos: 0 },
      { id: 102, nombre: 'Recordatorio', orden: 2, espera_sugerida_minutos: 240 },
      { id: 103, nombre: 'Último intento', orden: 3, espera_sugerida_minutos: 1440 },
    ],
  });

  test('deriva cuántas veces se abrió cada fase y cuándo fue la última', async () => {
    WhatsappFlujo.findAll.mockResolvedValue([flujoConTresFases()]);
    SeguimientoContacto.findAll.mockResolvedValue([
      { fase_id: 101, veces: '3', ultimo: '2026-10-03T18:42:00.000Z' },
      { fase_id: 102, veces: '1', ultimo: '2026-10-03T22:30:00.000Z' },
    ]);

    const [flujo] = await flujoService.estadoFlujosDelPedido(4321, CTX);

    expect(flujo.fases.map((f) => f.envios)).toEqual([3, 1, 0]);
    expect(flujo.fases[0].ultimo_envio_en).toBe('2026-10-03T18:42:00.000Z');
    expect(flujo.fases[2].ultimo_envio_en).toBeNull();
    expect(flujo.envios_totales).toBe(4);
  });

  test('una fase reenviada varias veces no queda bloqueada ni marca la siguiente', async () => {
    WhatsappFlujo.findAll.mockResolvedValue([flujoConTresFases()]);
    // El caso del usuario: abrió la Fase 1 dos veces y nunca pasó a la 2.
    SeguimientoContacto.findAll.mockResolvedValue([
      { fase_id: 101, veces: '2', ultimo: '2026-10-03T18:25:00.000Z' },
    ]);

    const [flujo] = await flujoService.estadoFlujosDelPedido(4321, CTX);

    // La fase 1 sigue disponible (nada en el modelo la deshabilita) y las
    // siguientes no se marcaron solas.
    expect(flujo.fases[0].envios).toBe(2);
    expect(flujo.fases[0]).not.toHaveProperty('bloqueada');
    expect(flujo.fases[1].envios).toBe(0);
    expect(flujo.fases[2].envios).toBe(0);
  });

  test('sin ningún envío, todas las fases arrancan en cero', async () => {
    WhatsappFlujo.findAll.mockResolvedValue([flujoConTresFases()]);

    const [flujo] = await flujoService.estadoFlujosDelPedido(4321, CTX);

    expect(flujo.fases.every((f) => f.envios === 0 && f.ultimo_envio_en === null)).toBe(true);
    expect(flujo.envios_totales).toBe(0);
  });
});

describe('validación de fases', () => {
  test('el flujo necesita al menos una fase', async () => {
    await expect(flujoService.crearFlujo({ nombre: 'Vacío', fases: [] }, CTX))
      .rejects.toMatchObject({ status: 422 });
  });

  test('el nombre del flujo es obligatorio', async () => {
    await expect(flujoService.crearFlujo({ nombre: '   ', fases: [{ nombre: 'F', mensaje: 'm' }] }, CTX))
      .rejects.toMatchObject({ status: 422 });
  });

  test('junta los motivos de todas las fases incompletas', async () => {
    const payload = {
      nombre: 'Confirmación',
      fases: [
        { nombre: '', mensaje: 'Hola' },
        { nombre: 'Recordatorio', mensaje: '   ' },
        { nombre: 'Último', mensaje: 'Hola', espera_sugerida_minutos: -5 },
      ],
    };
    await expect(flujoService.crearFlujo(payload, CTX)).rejects.toMatchObject({
      status: 422,
      errores: [
        'Fase 1: falta el nombre',
        'Fase 2: el mensaje no puede estar vacío',
        'Fase 3: la espera sugerida debe ser un número de minutos (0 o más)',
      ],
    });
  });

  test('el orden sale de la posición en el array, no de lo que manda el cliente', async () => {
    WhatsappFlujo.create.mockResolvedValue(fila({ id: 55 }));
    WhatsappFlujo.findOne.mockResolvedValue(fila({ id: 55, nombre: 'Confirmación', fases: [] }));

    await flujoService.crearFlujo({
      nombre: 'Confirmación',
      fases: [
        { nombre: 'Primer contacto', mensaje: 'a', orden: 99 },
        { nombre: 'Recordatorio', mensaje: 'b', orden: 1 },
      ],
    }, CTX);

    const ordenes = WhatsappFlujoFase.create.mock.calls.map(([datos]) => [datos.nombre, datos.orden]);
    expect(ordenes).toEqual([['Primer contacto', 1], ['Recordatorio', 2]]);
  });

  test('una espera vacía se guarda como inmediata (0), no como NaN', async () => {
    WhatsappFlujo.create.mockResolvedValue(fila({ id: 56 }));
    WhatsappFlujo.findOne.mockResolvedValue(fila({ id: 56, fases: [] }));

    await flujoService.crearFlujo({
      nombre: 'Confirmación',
      fases: [{ nombre: 'Primer contacto', mensaje: 'a', espera_sugerida_minutos: '' }],
    }, CTX);

    expect(WhatsappFlujoFase.create.mock.calls[0][0].espera_sugerida_minutos).toBe(0);
  });
});

describe('sacar una fase del flujo', () => {
  test('la fase que ya tiene envíos se desactiva, no se borra', async () => {
    const usada = fila({ id: 201, flujo_id: 10, nombre: 'Recordatorio', orden: 2, activo: true });
    const sinUsar = fila({ id: 202, flujo_id: 10, nombre: 'Último intento', orden: 3, activo: true });

    WhatsappFlujo.findOne
      .mockResolvedValueOnce(fila({ id: 10, nombre: 'Confirmación', activo: true }))
      .mockResolvedValue(fila({ id: 10, nombre: 'Confirmación', fases: [] }));
    WhatsappFlujoFase.findAll.mockResolvedValue([usada, sinUsar]);
    // Solo la 201 aparece en el historial de contactos.
    SeguimientoContacto.findAll.mockResolvedValue([{ fase_id: 201 }]);

    // El payload llega sin ninguna de las dos: el usuario las saco del flujo.
    await flujoService.actualizarFlujo(10, {
      nombre: 'Confirmación',
      fases: [{ nombre: 'Primer contacto', mensaje: 'a' }],
    }, CTX);

    expect(usada.destroy).not.toHaveBeenCalled();
    expect(usada.update).toHaveBeenCalledWith({ activo: false }, { transaction: 'TX' });
    expect(sinUsar.destroy).toHaveBeenCalled();
  });
});

describe('eliminarFlujo', () => {
  test('borra de verdad el flujo que nunca se usó', async () => {
    const flujo = fila({ id: 10, nombre: 'Confirmación', fases: [{ id: 101 }] });
    WhatsappFlujo.findOne.mockResolvedValue(flujo);
    SeguimientoContacto.findAll.mockResolvedValue([]);

    const res = await flujoService.eliminarFlujo(10, CTX);

    expect(res).toEqual({ desactivado: false });
    expect(flujo.destroy).toHaveBeenCalled();
  });

  test('el flujo con envíos queda inactivo para no perder el historial del pedido', async () => {
    const flujo = fila({ id: 10, nombre: 'Confirmación', fases: [{ id: 101 }] });
    WhatsappFlujo.findOne.mockResolvedValue(flujo);
    SeguimientoContacto.findAll.mockResolvedValue([{ fase_id: 101 }]);

    const res = await flujoService.eliminarFlujo(10, CTX);

    expect(res).toEqual({ desactivado: true });
    expect(flujo.destroy).not.toHaveBeenCalled();
    expect(flujo.activo).toBe(false);
    expect(WhatsappFlujoFase.update).toHaveBeenCalledWith(
      { activo: false },
      { where: { flujo_id: 10 }, transaction: 'TX' },
    );
  });

  test('un flujo de otro usuario no existe', async () => {
    WhatsappFlujo.findOne.mockResolvedValue(null);
    await expect(flujoService.eliminarFlujo(10, CTX)).rejects.toMatchObject({ status: 404 });
  });
});
