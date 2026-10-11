'use strict';

/**
 * Pestaña Resumen de Pedidos: qué mensaje le toca a cada pedido y cuándo.
 *
 * Lo que se verifica:
 *  - de dónde sale la fase (recordatorio > historial > flujo predeterminado);
 *  - cuándo cae cada pedido (ahora / hoy / después / sin fecha);
 *  - que los números del tablero son la cuenta de la MISMA lista que se
 *    muestra como cola;
 *  - que abrir WhatsApp cumple el recordatorio que correspondía, y agendar
 *    eligiendo fase la deja guardada.
 *
 * No toca la base: los modelos se mockean. La de localhost:5434 es
 * PRODUCCIÓN detrás de un túnel.
 */

const { Op } = require('sequelize');

jest.mock('../../models', () => ({
  sequelize: { transaction: (cb) => cb('TX') },
  Envio: { findOne: jest.fn(), findAll: jest.fn() },
  EnvioItem: { findAll: jest.fn() },
  WhatsappFlujo: { findAll: jest.fn() },
  WhatsappFlujoFase: { findOne: jest.fn() },
  EnvioEtiqueta: { findOne: jest.fn(), create: jest.fn() },
  SeguimientoContacto: { findAll: jest.fn(), create: jest.fn(), count: jest.fn() },
  SeguimientoRecordatorio: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn() },
}));
jest.mock('../../utils/historial', () => ({ registrarHistorial: jest.fn(async () => undefined) }));
jest.mock('../../services/queue/seguimientoQueue', () => ({ encolarRecordatorio: jest.fn(async () => undefined) }));

const {
  Envio, EnvioItem, WhatsappFlujo, WhatsappFlujoFase, SeguimientoContacto, SeguimientoRecordatorio,
} = require('../../models');
const servicio = require('../../services/seguimiento/pendientesSeguimiento.service');
const controller = require('../../controllers/envioSeguimientoController');

// 11 de octubre de 2026, 10:00 en Paraguay.
const AHORA = new Date('2026-10-11T13:00:00.000Z');
const enHoras = (h) => new Date(AHORA.getTime() + h * 3600 * 1000).toISOString();

const FLUJO = {
  id: 10, usuario_id: 7, nombre: 'Confirmación de pedido', tipo: 'CONFIRMACION_PEDIDO_WEB', predeterminado: true,
  fases: [
    { id: 103, orden: 3, nombre: 'Último intento', espera_sugerida_minutos: 1440, activo: true },
    { id: 101, orden: 1, nombre: 'Confirmación', espera_sugerida_minutos: 0, activo: true },
    { id: 102, orden: 2, nombre: 'Recordatorio', espera_sugerida_minutos: 240, activo: true },
  ],
};
const FLUJO_WHATSAPP = {
  id: 20, usuario_id: 7, nombre: 'Venta por WhatsApp', tipo: 'VENTA_WHATSAPP', predeterminado: true,
  fases: [{ id: 201, orden: 1, nombre: 'Cierre', espera_sugerida_minutos: 0, activo: true }],
};

const pedido = (id, extra = {}) => ({
  id, numero_pedido: id + 1000, usuario_id: 7, estado: 'Pendiente', origen: 'landing', monto: 150000,
  nombre_cliente: 'María', apellido_cliente: 'González', telefono: '0981 111 222', ciudad: 'Luque',
  created_at: enHoras(-30), ...extra,
});
const apertura = (envio_id, fase_id, haceHoras, flujo_id = 10) => ({
  envio_id, flujo_id, fase_id, veces: '1', ultimo: enHoras(-haceHoras),
});

function armar({ pedidos, recordatorios = [], aperturas = [], flujos = [FLUJO, FLUJO_WHATSAPP] }) {
  return servicio.armarPendientes({ pedidos, recordatorios, aperturas, flujos, ahora: AHORA });
}

describe('de dónde sale la fase', () => {
  test('pedido nuevo sin contactar: primera fase del flujo predeterminado, para ahora', () => {
    const [item] = armar({ pedidos: [pedido(1)] });

    expect(item).toMatchObject({
      fase_id: 101, fase_orden: 1, fase_origen: 'derivada', cuando: 'ahora', motivo: 'nuevo',
      cliente: 'María González', numero_pedido: 1001,
    });
  });

  test('pedido que entró por WhatsApp usa el flujo de ese origen', () => {
    const [item] = armar({ pedidos: [pedido(1, { origen: 'WHATSAPP' })] });

    expect(item).toMatchObject({ flujo_id: 20, fase_id: 201 });
  });

  test('la fase elegida al agendar manda sobre lo que diga el historial', () => {
    const [item] = armar({
      pedidos: [pedido(1, { estado: 'EnSeguimiento' })],
      aperturas: [apertura(1, 101, 5)],
      recordatorios: [{ id: 900, envio_id: 1, estado: 'PENDIENTE', ejecutar_en: enHoras(-1), fase_id: 103, flujo_id: 10 }],
    });

    // Por historial tocaría la 2; el operador agendó la 3.
    expect(item).toMatchObject({ fase_id: 103, fase_origen: 'recordatorio', cuando: 'ahora', motivo: 'vencido' });
  });

  test('recordatorio sin fase: la siguiente a la más avanzada que se abrió', () => {
    const [item] = armar({
      pedidos: [pedido(1, { estado: 'EnSeguimiento' })],
      // Fase 1 -> Fase 2 -> Fase 1 otra vez: lo más avanzado sigue siendo la 2.
      aperturas: [apertura(1, 102, 6), apertura(1, 101, 2)],
      recordatorios: [{ id: 900, envio_id: 1, estado: 'PENDIENTE', ejecutar_en: enHoras(2), fase_id: null }],
    });

    expect(item).toMatchObject({ fase_id: 103, fase_origen: 'derivada' });
  });

  test('con la última fase ya abierta no se inventa una: queda sin fase', () => {
    const [item] = armar({
      pedidos: [pedido(1, { estado: 'EnSeguimiento' })],
      aperturas: [apertura(1, 101, 30), apertura(1, 102, 20), apertura(1, 103, 5)],
    });

    expect(item).toMatchObject({ fase_id: null, flujo_id: null, cuando: 'sin_fecha', motivo: 'sin_agendar' });
  });
});

describe('cuándo', () => {
  const conRecordatorio = (ejecutar_en, estado = 'PENDIENTE') => armar({
    pedidos: [pedido(1, { estado: 'EnSeguimiento' })],
    aperturas: [apertura(1, 101, 5)],
    recordatorios: [{ id: 900, envio_id: 1, estado, ejecutar_en, fase_id: 102, flujo_id: 10 }],
  })[0];

  test('recordatorio en 4 horas, mismo día: hoy', () => {
    expect(conRecordatorio(enHoras(4))).toMatchObject({ cuando: 'hoy', motivo: 'programado' });
  });

  test('el corte del día es el de Paraguay, no el de UTC', () => {
    // 23:30 en Paraguay = 02:30 UTC del día siguiente: sigue siendo "hoy".
    expect(conRecordatorio('2026-10-12T02:30:00.000Z').cuando).toBe('hoy');
    // 00:30 en Paraguay del 12: ya es otro día.
    expect(conRecordatorio('2026-10-12T03:30:00.000Z').cuando).toBe('despues');
  });

  test('VENCIDO o con la hora cumplida: ahora', () => {
    expect(conRecordatorio(enHoras(-1)).cuando).toBe('ahora');
    expect(conRecordatorio(enHoras(-1), 'VENCIDO').cuando).toBe('ahora');
  });

  test('contactado y sin recordatorio: sin fecha', () => {
    const [item] = armar({ pedidos: [pedido(1, { estado: 'EnSeguimiento' })], aperturas: [apertura(1, 101, 5)] });

    expect(item).toMatchObject({ cuando: 'sin_fecha', motivo: 'sin_agendar', fase_id: 102 });
  });

  test('lo urgente primero; dentro del grupo, lo que hace más que espera', () => {
    const items = armar({
      pedidos: [
        pedido(1, { created_at: enHoras(-2) }),
        pedido(2, { created_at: enHoras(-50) }),
        pedido(3, { estado: 'EnSeguimiento' }),
      ],
      aperturas: [apertura(3, 101, 5)],
      recordatorios: [{ id: 900, envio_id: 3, estado: 'PENDIENTE', ejecutar_en: enHoras(3), fase_id: 102, flujo_id: 10 }],
    });

    expect(items.map((i) => i.envio_id)).toEqual([2, 1, 3]);
  });
});

describe('los números del tablero', () => {
  test('son la cuenta de la misma lista, fase por fase', () => {
    const items = armar({
      pedidos: [
        pedido(1), pedido(2),                              // nuevos -> fase 1, ahora
        pedido(3, { estado: 'EnSeguimiento' }),            // fase 2, hoy
        pedido(4, { estado: 'EnSeguimiento' }),            // fase 2, ahora
        pedido(5, { estado: 'EnSeguimiento' }),            // flujo terminado -> sin fase
      ],
      aperturas: [
        apertura(3, 101, 5), apertura(4, 101, 9),
        apertura(5, 101, 30), apertura(5, 102, 20), apertura(5, 103, 5),
      ],
      recordatorios: [
        { id: 900, envio_id: 3, estado: 'PENDIENTE', ejecutar_en: enHoras(4), fase_id: 102, flujo_id: 10 },
        { id: 901, envio_id: 4, estado: 'VENCIDO', ejecutar_en: enHoras(-3), fase_id: 102, flujo_id: 10 },
      ],
    });
    const resumen = servicio.resumirPorFase(items, [FLUJO, FLUJO_WHATSAPP]);

    expect(resumen.totales).toEqual({ ahora: 3, hoy: 1, despues: 0, sin_fecha: 1 });
    expect(resumen.sin_fase).toEqual({ ahora: 0, hoy: 0, despues: 0, sin_fecha: 1 });
    expect(resumen.flujos).toHaveLength(1); // el de WhatsApp no tiene nada pendiente
    expect(resumen.flujos[0].fases.map((f) => [f.orden, f.ahora, f.hoy])).toEqual([[1, 2, 0], [2, 1, 1], [3, 0, 0]]);

    // Cada número del tablero se puede reconstruir filtrando la lista.
    for (const fase of resumen.flujos[0].fases) {
      for (const cuando of ['ahora', 'hoy', 'despues', 'sin_fecha']) {
        expect(items.filter((i) => i.fase_id === fase.id && i.cuando === cuando)).toHaveLength(fase[cuando]);
      }
    }
  });

  test('sin nada pendiente muestra el flujo predeterminado en cero', () => {
    const resumen = servicio.resumirPorFase([], [FLUJO_WHATSAPP, FLUJO]);

    expect(resumen.totales).toEqual({ ahora: 0, hoy: 0, despues: 0, sin_fecha: 0 });
    expect(resumen.flujos.map((f) => f.id)).toEqual([10]);
  });
});

describe('ventas del período', () => {
  test('cada estado cae en un solo grupo y la suma es el total', () => {
    const ventas = servicio.agruparVentas([
      { estado: 'Pendiente', cantidad: '4', monto: '400000' },
      { estado: 'EnSeguimiento', cantidad: '2', monto: '200000' },
      { estado: 'Despachado', cantidad: '3', monto: '300000' },
      { estado: 'Entregado', cantidad: '5', monto: '500000' },
      { estado: 'Cancelado', cantidad: '1', monto: '100000' },
      { estado: 'Devuelto', cantidad: '1', monto: '90000' },
    ]);

    expect(ventas.por_confirmar).toEqual({ cantidad: 6, monto: 600000 });
    expect(ventas.en_curso).toEqual({ cantidad: 3, monto: 300000 });
    expect(ventas.entregados).toEqual({ cantidad: 5, monto: 500000 });
    expect(ventas.recibidos).toEqual({ cantidad: 16, monto: 1590000 });

    const grupos = ['por_confirmar', 'en_curso', 'entregados', 'cancelados', 'devueltos_perdidos', 'otros'];
    expect(grupos.reduce((acc, g) => acc + ventas[g].cantidad, 0)).toBe(ventas.recibidos.cantidad);
  });
});

describe('pendientesDeSeguimiento', () => {
  test('respeta el alcance que le pasan y deja afuera los pedidos cerrados', async () => {
    Envio.findAll.mockResolvedValue([pedido(1)]);
    WhatsappFlujo.findAll.mockResolvedValue([FLUJO]);
    SeguimientoRecordatorio.findAll.mockResolvedValue([]);
    SeguimientoContacto.findAll.mockResolvedValue([]);
    EnvioItem.findAll.mockResolvedValue([{ envio_id: 1, nombre_producto: 'Mancuerna 5kg', cantidad: 2 }]);

    const res = await servicio.pendientesDeSeguimiento({
      whereBase: { usuario_id: 7, tienda_id: 9 }, usuarioId: 7, esAdmin: false, ahora: AHORA,
    });

    const { where } = Envio.findAll.mock.calls[0][0];
    expect(where.usuario_id).toBe(7);
    expect(where.tienda_id).toBe(9);
    expect(where[Op.and][0].estado[Op.notIn]).toEqual(['Entregado', 'Cancelado', 'Devuelto', 'Perdido']);
    expect(res.items[0].productos).toBe('Mancuerna 5kg x2');
    expect(res.totales.ahora).toBe(1);
    expect(res.truncado).toBe(false);
  });
});

describe('abrir WhatsApp cumple el recordatorio que correspondía', () => {
  function fila(datos) {
    return { ...datos, update: jest.fn(async function (c) { Object.assign(this, c); return this; }) };
  }
  function respuesta() {
    const res = { codigo: 200, cuerpo: undefined };
    res.status = jest.fn((c) => { res.codigo = c; return res; });
    res.json = jest.fn((cuerpo) => { res.cuerpo = cuerpo; return res; });
    return res;
  }
  const peticion = (body) => ({ usuario: { id: 7, rol: 'usuario', tiendaId: 9 }, params: { id: '50' }, body });

  beforeEach(() => {
    jest.clearAllMocks();
    Envio.findOne.mockResolvedValue(fila({ id: 50, estado: 'EnSeguimiento', telefono: '0981 111 222', items: [] }));
    WhatsappFlujoFase.findOne.mockResolvedValue({
      id: 102, flujo_id: 10, orden: 2, nombre: 'Recordatorio', mensaje: 'Hola', etiqueta_id: null,
      flujo: { nombre: 'Confirmación de pedido' },
    });
    SeguimientoContacto.create.mockResolvedValue({ id: 1 });
    SeguimientoContacto.count.mockResolvedValue(1);
  });

  test('el vencido y el que era para esta fase quedan cumplidos; uno futuro de otra fase no', async () => {
    const vencido = fila({ id: 900, estado: 'VENCIDO', ejecutar_en: new Date(Date.now() - 3600e3), fase_id: null });
    const deEstaFase = fila({ id: 901, estado: 'PENDIENTE', ejecutar_en: new Date(Date.now() + 3600e3), fase_id: 102 });
    const deOtraFase = fila({ id: 902, estado: 'PENDIENTE', ejecutar_en: new Date(Date.now() + 3600e3), fase_id: 103 });
    SeguimientoRecordatorio.findAll.mockResolvedValue([vencido, deEstaFase, deOtraFase]);
    const res = respuesta();

    await controller.registrarContacto(peticion({ fase_id: 102 }), res, jest.fn());

    expect(res.codigo).toBe(201);
    expect(vencido.estado).toBe('COMPLETADO');
    expect(deEstaFase.estado).toBe('COMPLETADO');
    expect(deOtraFase.estado).toBe('PENDIENTE');
    expect(res.cuerpo.recordatorios_cumplidos).toEqual([900, 901]);
  });

  test('agendar eligiendo fase la guarda junto con su flujo', async () => {
    SeguimientoRecordatorio.findOne.mockResolvedValue(null);
    SeguimientoRecordatorio.create.mockImplementation(async (datos) => fila({ id: 905, version: 1, ...datos }));
    SeguimientoRecordatorio.update.mockResolvedValue([0]);
    const res = respuesta();

    await controller.programarRecordatorio(peticion({ horas: 4, fase_id: 102 }), res, jest.fn());

    expect(res.codigo).toBe(201);
    expect(SeguimientoRecordatorio.create.mock.calls[0][0]).toMatchObject({ envio_id: 50, fase_id: 102, flujo_id: 10 });
    // La fase se busca dentro de los flujos de la cuenta.
    expect(WhatsappFlujoFase.findOne.mock.calls[0][0].include[0].where).toEqual({ usuario_id: 7 });
  });

  test('una fase que no es de la cuenta: 404 y no se agenda nada', async () => {
    WhatsappFlujoFase.findOne.mockResolvedValue(null);
    const res = respuesta();

    await controller.programarRecordatorio(peticion({ horas: 4, fase_id: 999 }), res, jest.fn());

    expect(res.codigo).toBe(404);
    expect(SeguimientoRecordatorio.create).not.toHaveBeenCalled();
  });
});
