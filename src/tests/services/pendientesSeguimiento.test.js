'use strict';

/**
 * Tablero Kanban de seguimiento: en qué fase está cada pedido y cuándo toca.
 *
 * Lo que se verifica:
 *  - la fase avanza SOLO cuando el operador la marca como completada; abrir
 *    WhatsApp no mueve al pedido de columna;
 *  - de dónde sale la fase (recordatorio > fases completadas > predeterminado);
 *  - cuándo cae cada pedido (ahora / hoy / después / sin fecha);
 *  - el filtrado y la paginación los resuelve el backend, y el contador de
 *    una columna es la cuenta de la misma lista que se pagina;
 *  - marcar una fase como completada cumple el recordatorio que correspondía.
 *
 * No toca la base: los modelos se mockean. La de localhost:5434 es
 * PRODUCCIÓN detrás de un túnel.
 */

const { Op } = require('sequelize');

jest.mock('../../models', () => ({
  sequelize: { transaction: (cb) => cb('TX') },
  Envio: { findOne: jest.fn(), findAll: jest.fn(), count: jest.fn() },
  EnvioItem: { findAll: jest.fn() },
  EnvioHistorial: { findAll: jest.fn() },
  WhatsappFlujo: { findAll: jest.fn(), create: jest.fn(), count: jest.fn() },
  WhatsappFlujoFase: { findOne: jest.fn(), create: jest.fn() },
  EnvioEtiqueta: { findOne: jest.fn(), create: jest.fn() },
  SeguimientoContacto: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), count: jest.fn() },
  SeguimientoRecordatorio: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), update: jest.fn() },
}));
jest.mock('../../utils/historial', () => ({ registrarHistorial: jest.fn(async () => undefined) }));
jest.mock('../../services/queue/seguimientoQueue', () => ({ encolarRecordatorio: jest.fn(async () => undefined) }));

const {
  Envio, EnvioItem, EnvioHistorial, WhatsappFlujo, WhatsappFlujoFase, SeguimientoContacto, SeguimientoRecordatorio,
} = require('../../models');
const flujoService = require('../../services/seguimiento/flujo.service');
const { etapaDelPedido } = require('../../services/seguimiento/flujosBase');
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
const abierta = (envio_id, fase_id, haceHoras, flujo_id = 10) => ({
  envio_id, flujo_id, fase_id, estado: 'ABIERTO_EN_WHATSAPP', veces: '1', ultimo: enHoras(-haceHoras),
});
const completada = (envio_id, fase_id, haceHoras, flujo_id = 10) => ({
  envio_id, flujo_id, fase_id, estado: 'CONFIRMADO_POR_OPERADOR', veces: '1', ultimo: enHoras(-haceHoras),
});

const FLUJO_ENVIO = {
  id: 30, usuario_id: 7, nombre: 'Seguimiento de envío', tipo: 'SEGUIMIENTO_ENVIO', predeterminado: true,
  fases: [
    { id: 301, orden: 1, nombre: 'Pedido confirmado', espera_sugerida_minutos: 0, activo: true },
    { id: 302, orden: 2, nombre: 'Pedido despachado', espera_sugerida_minutos: 0, activo: true },
  ],
};
const TRES_DIAS = 3 * 24 * 60;
const FLUJO_RECOMPRA = {
  id: 40, usuario_id: 7, nombre: 'Escalamiento de ventas', tipo: 'ESCALAMIENTO_VENTAS', predeterminado: true,
  fases: [
    { id: 401, orden: 1, nombre: '¿Cómo te fue?', espera_sugerida_minutos: TRES_DIAS, activo: true },
    { id: 402, orden: 2, nombre: 'Nueva compra', espera_sugerida_minutos: 7 * 24 * 60, activo: true },
  ],
};
const TODOS_LOS_FLUJOS = [FLUJO, FLUJO_WHATSAPP, FLUJO_ENVIO, FLUJO_RECOMPRA];

function armar({ etapa = 'CONFIRMACION_PEDIDO_WEB', pedidos, recordatorios = [], contactos = [], flujos = TODOS_LOS_FLUJOS, entregas }) {
  return servicio.armarPendientes({ etapa, pedidos, recordatorios, contactos, flujos, entregas, ahora: AHORA });
}

describe('en qué fase está el pedido', () => {
  test('pedido nuevo: primera fase del flujo predeterminado, para ahora', () => {
    const [item] = armar({ pedidos: [pedido(1)] });

    expect(item).toMatchObject({
      fase_id: 101, fase_orden: 1, cuando: 'ahora', motivo: 'nuevo', fase_abierta_en: null,
      cliente: 'María González', numero_pedido: 1001,
    });
  });

  test('abrir WhatsApp NO avanza la fase: sigue en la 1, marcada como abierta sin completar', () => {
    const [item] = armar({ pedidos: [pedido(1, { estado: 'EnSeguimiento' })], contactos: [abierta(1, 101, 2)] });

    expect(item).toMatchObject({ fase_id: 101, cuando: 'ahora', motivo: 'nuevo' });
    expect(item.fase_abierta_en).toBe(enHoras(-2));
  });

  test('al marcar la fase 1 como completada pasa a la 2', () => {
    const [item] = armar({ pedidos: [pedido(1, { estado: 'EnSeguimiento' })], contactos: [completada(1, 101, 2)] });

    expect(item).toMatchObject({ fase_id: 102, fase_orden: 2, cuando: 'sin_fecha', motivo: 'sin_agendar', fase_abierta_en: null });
  });

  test('reenviar una fase anterior no hace retroceder al pedido', () => {
    const [item] = armar({
      pedidos: [pedido(1, { estado: 'EnSeguimiento' })],
      // Completó 1 y 2, y después volvió a abrir la 1.
      contactos: [completada(1, 101, 9), completada(1, 102, 6), abierta(1, 101, 1)],
    });

    expect(item).toMatchObject({ fase_id: 103, fase_orden: 3 });
  });

  test('la fase elegida al agendar manda sobre las completadas', () => {
    const [item] = armar({
      pedidos: [pedido(1, { estado: 'EnSeguimiento' })],
      contactos: [completada(1, 101, 5)],
      recordatorios: [{ id: 900, envio_id: 1, estado: 'PENDIENTE', ejecutar_en: enHoras(-1), fase_id: 103, flujo_id: 10 }],
    });

    expect(item).toMatchObject({ fase_id: 103, fase_origen: 'recordatorio', cuando: 'ahora', motivo: 'vencido' });
  });

  test('con todas las fases completadas no queda fase, pero sigue siendo de su flujo', () => {
    const [item] = armar({
      pedidos: [pedido(1, { estado: 'EnSeguimiento' })],
      contactos: [completada(1, 101, 30), completada(1, 102, 20), completada(1, 103, 5)],
    });

    expect(item).toMatchObject({ fase_id: null, flujo_id: 10, cuando: 'sin_fecha' });
  });

  test('en la etapa Venta por WhatsApp se usa el flujo de esa etapa', () => {
    const [item] = armar({ etapa: 'VENTA_WHATSAPP', pedidos: [pedido(1, { origen: 'WHATSAPP' })] });

    expect(item).toMatchObject({ etapa: 'VENTA_WHATSAPP', flujo_id: 20, fase_id: 201 });
  });
});

describe('las etapas: el pedido cambia solo según su estado', () => {
  test('cada estado cae en su etapa', () => {
    expect(etapaDelPedido({ estado: 'Pendiente', origen: 'landing' })).toBe('CONFIRMACION_PEDIDO_WEB');
    expect(etapaDelPedido({ estado: 'EnSeguimiento', origen: 'WhatsApp' })).toBe('VENTA_WHATSAPP');
    for (const estado of ['Confirmado', 'Preparado', 'Despachado', 'Reprogramado']) {
      expect(etapaDelPedido({ estado, origen: 'WhatsApp' })).toBe('SEGUIMIENTO_ENVIO');
    }
    expect(etapaDelPedido({ estado: 'Entregado' })).toBe('ESCALAMIENTO_VENTAS');
    expect(etapaDelPedido({ estado: 'Cancelado' })).toBeNull();
  });

  test('al confirmarse arranca el seguimiento de envío de cero: lo de confirmación no cuenta', () => {
    const [item] = armar({
      etapa: 'SEGUIMIENTO_ENVIO',
      pedidos: [pedido(1, { estado: 'Confirmado' })],
      // Los tres mensajes de confirmación ya estaban completados.
      contactos: [completada(1, 101, 30), completada(1, 102, 20), completada(1, 103, 5)],
    });

    expect(item).toMatchObject({ flujo_id: 30, fase_id: 301, fase_orden: 1, cuando: 'ahora', motivo: 'nuevo' });
  });

  test('en seguimiento de envío avanza al marcar cada aviso', () => {
    const [item] = armar({
      etapa: 'SEGUIMIENTO_ENVIO',
      pedidos: [pedido(1, { estado: 'Despachado' })],
      contactos: [completada(1, 301, 4, 30)],
    });

    expect(item).toMatchObject({ fase_id: 302, fase_nombre: 'Pedido despachado' });
  });
});

describe('escalamiento de ventas: la espera del primer mensaje se cuenta desde la entrega', () => {
  const entregado = (id, haceDias) => ({
    pedidos: [pedido(id, { estado: 'Entregado', updated_at: enHoras(-haceDias * 24) })],
    entregas: new Map([[id, enHoras(-haceDias * 24)]]),
  });

  test('entregado hace 1 día con espera de 3: todavía no toca, queda agendado', () => {
    const [item] = armar({ etapa: 'ESCALAMIENTO_VENTAS', ...entregado(1, 1) });

    expect(item).toMatchObject({ fase_id: 401, cuando: 'despues', motivo: 'programado' });
    expect(item.toca_en).toBe(enHoras(-24 + 72));
  });

  test('entregado hace 4 días: ya toca', () => {
    const [item] = armar({ etapa: 'ESCALAMIENTO_VENTAS', ...entregado(1, 4) });

    expect(item).toMatchObject({ fase_id: 401, cuando: 'ahora', motivo: 'nuevo' });
  });

  test('cambiar los días en el flujo cambia cuándo toca', () => {
    const conUnDia = { ...FLUJO_RECOMPRA, fases: [{ ...FLUJO_RECOMPRA.fases[0], espera_sugerida_minutos: 24 * 60 }, FLUJO_RECOMPRA.fases[1]] };
    const [item] = armar({ etapa: 'ESCALAMIENTO_VENTAS', ...entregado(1, 2), flujos: [conUnDia] });

    expect(item.cuando).toBe('ahora');
  });

  test('sin fecha de entrega en el historial usa la última modificación del pedido', () => {
    const [item] = armar({
      etapa: 'ESCALAMIENTO_VENTAS',
      pedidos: [pedido(1, { estado: 'Entregado', updated_at: enHoras(-5 * 24) })],
    });

    expect(item.entregado_en).toBe(enHoras(-5 * 24));
    expect(item.cuando).toBe('ahora');
  });

  test('quien ya recibió todos los mensajes sale del tablero', () => {
    const items = armar({
      etapa: 'ESCALAMIENTO_VENTAS',
      ...entregado(1, 20),
      contactos: [completada(1, 401, 400, 40), completada(1, 402, 100, 40)],
    });

    expect(items).toEqual([]);
  });
});

describe('cuándo', () => {
  const conRecordatorio = (ejecutar_en, estado = 'PENDIENTE') => armar({
    pedidos: [pedido(1, { estado: 'EnSeguimiento' })],
    contactos: [completada(1, 101, 5)],
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

  test('lo urgente primero; dentro del grupo, lo que hace más que espera', () => {
    const items = armar({
      pedidos: [
        pedido(1, { created_at: enHoras(-2) }),
        pedido(2, { created_at: enHoras(-50) }),
        pedido(3, { estado: 'EnSeguimiento' }),
      ],
      contactos: [completada(3, 101, 5)],
      recordatorios: [{ id: 900, envio_id: 3, estado: 'PENDIENTE', ejecutar_en: enHoras(3), fase_id: 102, flujo_id: 10 }],
    });

    expect(items.map((i) => i.envio_id)).toEqual([2, 1, 3]);
  });
});

describe('el tablero: filtrado y paginación en el backend', () => {
  // 25 pedidos nuevos (fase 1), 3 en fase 2 (uno vencido), 1 con el flujo terminado.
  const items = () => armar({
    pedidos: [
      ...Array.from({ length: 25 }, (_, i) => pedido(i + 1, { nombre_cliente: `Cliente${i + 1}`, apellido_cliente: '' })),
      pedido(30, { estado: 'EnSeguimiento', nombre_cliente: 'Carlos', apellido_cliente: 'Benítez', telefono: '0985 777 123' }),
      pedido(31, { estado: 'EnSeguimiento' }),
      pedido(32, { estado: 'EnSeguimiento' }),
      pedido(40, { estado: 'EnSeguimiento' }),
    ],
    contactos: [
      completada(30, 101, 9), completada(31, 101, 8), completada(32, 101, 7),
      completada(40, 101, 30), completada(40, 102, 20), completada(40, 103, 5),
    ],
    recordatorios: [
      { id: 900, envio_id: 30, estado: 'VENCIDO', ejecutar_en: enHoras(-3), fase_id: 102, flujo_id: 10 },
      { id: 901, envio_id: 31, estado: 'PENDIENTE', ejecutar_en: enHoras(4), fase_id: 102, flujo_id: 10 },
    ],
  });

  test('una columna por fase, cada una con su página y su total', () => {
    const tablero = servicio.armarTablero(items(), [FLUJO], { limit: 10 });

    expect(tablero.flujo_id).toBe(10);
    expect(tablero.columnas.map((c) => [c.clave, c.nombre, c.total, c.data.length, c.totalPages])).toEqual([
      ['101', 'Confirmación', 25, 10, 3],
      ['102', 'Recordatorio', 3, 3, 1],
      ['103', 'Último intento', 0, 0, 1],
      ['sin_fase', 'Flujo terminado', 1, 1, 1],
    ]);
    expect(tablero.totales).toEqual({ ahora: 26, hoy: 1, despues: 0, sin_fecha: 2 });
    expect(tablero.columnas[1].conteo).toEqual({ ahora: 1, hoy: 1, despues: 0, sin_fecha: 1 });
  });

  test('cada columna se pagina por separado y las páginas no se pisan', () => {
    const todos = items();
    const pagina = (n) => servicio.armarTablero(todos, [FLUJO], { limit: 10, paginas: { 101: n } }).columnas[0];

    const vistos = [1, 2, 3].flatMap((n) => pagina(n).data.map((i) => i.envio_id));
    expect(pagina(3).data).toHaveLength(5);
    expect(new Set(vistos).size).toBe(25);
    // Pedir una página que no existe devuelve la última, no una vacía.
    expect(pagina(9).page).toBe(3);
  });

  test('buscar y filtrar por cuándo achica las tarjetas, no los contadores del encabezado', () => {
    const tablero = servicio.armarTablero(items(), [FLUJO], { busqueda: 'benítez', limit: 10 });

    expect(tablero.columnas.map((c) => c.total)).toEqual([0, 1, 0, 0]);
    expect(tablero.columnas[1].data[0].cliente).toBe('Carlos Benítez');
    expect(tablero.columnas[0].conteo.ahora).toBe(25);

    const porTelefono = servicio.armarTablero(items(), [FLUJO], { busqueda: '0985777', limit: 10 });
    expect(porTelefono.columnas[1].data.map((i) => i.envio_id)).toEqual([30]);

    const porNumero = servicio.armarTablero(items(), [FLUJO], { busqueda: '#1031', limit: 10 });
    expect(porNumero.columnas[1].data.map((i) => i.envio_id)).toEqual([31]);

    const soloHoy = servicio.armarTablero(items(), [FLUJO], { cuando: 'hoy', limit: 10 });
    expect(soloHoy.columnas.map((c) => c.total)).toEqual([0, 1, 0, 0]);
  });

  test('la lista plana (cola de trabajo) también sale paginada y filtrada', () => {
    const paraAhora = servicio.filtrar(items(), { cuando: 'ahora' });
    const pagina = servicio.paginar(paraAhora, { page: 2, limit: 20 });

    expect(pagina).toMatchObject({ total: 26, page: 2, totalPages: 2, limit: 20 });
    expect(pagina.data).toHaveLength(6);
    expect(servicio.paginar(paraAhora, { limit: 9999 }).limit).toBe(50); // tope de registros por página
  });

  test('sin nada pendiente muestra el flujo predeterminado de la etapa con sus columnas en cero', () => {
    const otro = { ...FLUJO, id: 11, nombre: 'Confirmación alternativa', predeterminado: false };
    const tablero = servicio.armarTablero([], [otro, FLUJO], {});

    expect(tablero.flujo_id).toBe(10);
    expect(tablero.columnas.map((c) => c.total)).toEqual([0, 0, 0]);
    expect(tablero.flujos.map((f) => [f.id, f.predeterminado])).toEqual([[11, false], [10, true]]);
  });
});

describe('tableroDeSeguimiento', () => {
  test('respeta el alcance, deja afuera los pedidos cerrados y solo busca productos de lo que devuelve', async () => {
    // 1ª consulta de flujos: qué tipos tiene la cuenta (no falta ninguno).
    // Las siguientes: los flujos activos con sus fases.
    WhatsappFlujo.findAll.mockImplementation(async (opciones) => (
      opciones.group ? TODOS_LOS_FLUJOS.map((f) => ({ tipo: f.tipo })) : TODOS_LOS_FLUJOS
    ));
    Envio.findAll.mockImplementation(async (opciones) => (
      opciones.group ? [{ estado: 'Pendiente', es_whatsapp: false, cantidad: '12' }, { estado: 'Despachado', es_whatsapp: false, cantidad: '4' }]
        : Array.from({ length: 12 }, (_, i) => pedido(i + 1))
    ));
    Envio.count.mockResolvedValue(3);
    SeguimientoRecordatorio.findAll.mockResolvedValue([]);
    SeguimientoContacto.findAll.mockResolvedValue([]);
    EnvioItem.findAll.mockResolvedValue([{ envio_id: 1, nombre_producto: 'Mancuerna 5kg', cantidad: 2 }]);

    const res = await servicio.tableroDeSeguimiento({
      whereBase: { usuario_id: 7, tienda_id: 9 }, usuarioId: 7, esAdmin: false, ahora: AHORA, filtros: { limit: 5 },
    });

    const { where } = Envio.findAll.mock.calls.find(([o]) => !o.group)[0];
    expect(where.usuario_id).toBe(7);
    expect(where.tienda_id).toBe(9);
    // Sin etapa en el pedido, arranca en confirmación web: solo por confirmar.
    expect(where[Op.and][0].estado[Op.in]).toEqual(['Pendiente', 'EnSeguimiento']);
    expect(res.etapa).toBe('CONFIRMACION_PEDIDO_WEB');
    expect(res.etapas.map((e) => [e.tipo, e.pedidos])).toEqual([
      ['CONFIRMACION_PEDIDO_WEB', 12], ['VENTA_WHATSAPP', 0], ['SEGUIMIENTO_ENVIO', 4], ['ESCALAMIENTO_VENTAS', 3],
    ]);
    // No faltaba ningún flujo base: no se creó nada.
    expect(WhatsappFlujo.create).not.toHaveBeenCalled();

    expect(res.columnas[0].total).toBe(12);
    expect(res.columnas[0].data).toHaveLength(5);
    // Productos: solo de las 5 tarjetas de la página, no de los 12 pedidos.
    expect(EnvioItem.findAll.mock.calls[0][0].where.envio_id[Op.in]).toHaveLength(5);
    expect(res.columnas[0].data.find((i) => i.envio_id === 1).productos).toBe('Mancuerna 5kg x2');
  });
});

describe('los cuatro flujos base', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a una cuenta que solo tiene confirmación web se le crean los otros tres, con sus mensajes', async () => {
    WhatsappFlujo.findAll.mockResolvedValue([{ tipo: 'CONFIRMACION_PEDIDO_WEB' }]);
    WhatsappFlujo.create.mockImplementation(async (datos) => ({ id: 500, ...datos }));
    WhatsappFlujoFase.create.mockResolvedValue({});

    const creados = await flujoService.asegurarFlujosBase({ usuarioId: 7 });

    expect(creados).toBe(3);
    expect(WhatsappFlujo.create.mock.calls.map(([d]) => [d.tipo, d.predeterminado, d.usuario_id])).toEqual([
      ['VENTA_WHATSAPP', true, 7], ['SEGUIMIENTO_ENVIO', true, 7], ['ESCALAMIENTO_VENTAS', true, 7],
    ]);
    // El primer mensaje de recompra nace con 3 días desde la entrega.
    const primeraDeRecompra = WhatsappFlujoFase.create.mock.calls.map(([d]) => d).filter((d) => d.orden === 1).pop();
    expect(primeraDeRecompra.espera_sugerida_minutos).toBe(3 * 24 * 60);
  });

  test('con los cuatro tipos ya presentes no crea nada', async () => {
    WhatsappFlujo.findAll.mockResolvedValue(TODOS_LOS_FLUJOS.map((f) => ({ tipo: f.tipo })));

    expect(await flujoService.asegurarFlujosBase({ usuarioId: 7 })).toBe(0);
    expect(WhatsappFlujo.create).not.toHaveBeenCalled();
  });

  test('si dos pedidos intentan crear el mismo a la vez, el segundo no rompe', async () => {
    WhatsappFlujo.findAll.mockResolvedValue(TODOS_LOS_FLUJOS.slice(0, 3).map((f) => ({ tipo: f.tipo })));
    WhatsappFlujo.create.mockRejectedValue(Object.assign(new Error('duplicado'), { name: 'SequelizeUniqueConstraintError' }));

    await expect(flujoService.asegurarFlujosBase({ usuarioId: 7 })).resolves.toBe(0);
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
    expect(ventas.recibidos).toEqual({ cantidad: 16, monto: 1590000 });
    const grupos = ['por_confirmar', 'en_curso', 'entregados', 'cancelados', 'devueltos_perdidos', 'otros'];
    expect(grupos.reduce((acc, g) => acc + ventas[g].cantidad, 0)).toBe(ventas.recibidos.cantidad);
  });
});

describe('marcar una fase como completada', () => {
  function fila(datos) {
    return { ...datos, update: jest.fn(async function (c) { Object.assign(this, c); return this; }) };
  }
  function respuesta() {
    const res = { codigo: 200, cuerpo: undefined };
    res.status = jest.fn((c) => { res.codigo = c; return res; });
    res.json = jest.fn((cuerpo) => { res.cuerpo = cuerpo; return res; });
    res.send = jest.fn(() => res);
    return res;
  }
  const peticion = (body = {}, params = {}) => ({
    usuario: { id: 7, rol: 'usuario', tiendaId: 9 }, params: { id: '50', faseId: '102', ...params }, body,
  });
  const FASE_2 = {
    id: 102, flujo_id: 10, orden: 2, nombre: 'Recordatorio', mensaje: 'Hola', etiqueta_id: null,
    flujo: { nombre: 'Confirmación de pedido' },
  };
  const FASE_3 = { id: 103, flujo_id: 10, orden: 3, nombre: 'Último intento', espera_sugerida_minutos: 1440 };

  let envio;
  beforeEach(() => {
    jest.clearAllMocks();
    envio = fila({ id: 50, estado: 'EnSeguimiento', telefono: '0981 111 222', items: [] });
    Envio.findOne.mockResolvedValue(envio);
    // 1ª llamada: la fase que se completa; 2ª: la siguiente del flujo.
    // mockReset: clearAllMocks no vacía la cola de valores "Once" que dejó la prueba anterior.
    WhatsappFlujoFase.findOne.mockReset().mockResolvedValueOnce(FASE_2).mockResolvedValueOnce(FASE_3);
    SeguimientoContacto.findOne.mockReset();
    SeguimientoRecordatorio.findAll.mockResolvedValue([]);
    SeguimientoContacto.count.mockResolvedValue(1);
  });

  test('la apertura pendiente pasa a completada y el mensaje siguiente queda agendado solo', async () => {
    const apertura = fila({ id: 1, estado: 'ABIERTO_EN_WHATSAPP' });
    SeguimientoContacto.findOne.mockResolvedValueOnce(apertura);
    SeguimientoRecordatorio.findOne.mockResolvedValue(null);
    SeguimientoRecordatorio.create.mockImplementation(async (datos) => fila({ id: 950, version: 1, ...datos }));
    const antes = Date.now();
    const res = respuesta();

    await controller.completarFase(peticion(), res, jest.fn());

    expect(apertura.estado).toBe('CONFIRMADO_POR_OPERADOR');
    expect(SeguimientoContacto.create).not.toHaveBeenCalled();
    expect(res.cuerpo.siguiente_fase).toMatchObject({ id: 103, orden: 3, espera_sugerida_minutos: 1440 });
    // Sin preguntar: el recordatorio del mensaje 3 queda para dentro de 1 día.
    const agendado = SeguimientoRecordatorio.create.mock.calls[0][0];
    expect(agendado).toMatchObject({ envio_id: 50, fase_id: 103, flujo_id: 10 });
    expect(new Date(agendado.ejecutar_en).getTime() - antes).toBeGreaterThanOrEqual(1440 * 60 * 1000 - 5);
    expect(res.cuerpo.recordatorio).toMatchObject({ id: 950, fase_id: 103 });
    // El pedido se busca dentro de la cuenta y la tienda activa.
    expect(Envio.findOne.mock.calls[0][0].where).toEqual({ id: '50', usuario_id: 7, tienda_id: 9 });
  });

  test('si la persona ya había agendado algo a futuro, no se le pisa', async () => {
    SeguimientoContacto.findOne.mockResolvedValueOnce(fila({ id: 1, estado: 'ABIERTO_EN_WHATSAPP' }));
    SeguimientoRecordatorio.findOne.mockResolvedValue(fila({ id: 77, estado: 'PENDIENTE' }));
    const res = respuesta();

    await controller.completarFase(peticion(), res, jest.fn());

    expect(SeguimientoRecordatorio.create).not.toHaveBeenCalled();
    expect(res.cuerpo.recordatorio).toBeNull();
  });

  test('si se mandó a mano, sin abrir desde el sistema, se registra igual', async () => {
    SeguimientoContacto.findOne.mockResolvedValue(null);
    SeguimientoContacto.create.mockImplementation(async (datos) => fila({ id: 2, ...datos }));
    const res = respuesta();

    await controller.completarFase(peticion(), res, jest.fn());

    expect(SeguimientoContacto.create.mock.calls[0][0]).toMatchObject({
      envio_id: 50, fase_id: 102, flujo_id: 10, estado: 'CONFIRMADO_POR_OPERADOR',
    });
  });

  test('cumple el vencido y el que era para esta fase; uno futuro de otra fase no', async () => {
    SeguimientoContacto.findOne.mockResolvedValueOnce(fila({ id: 1, estado: 'ABIERTO_EN_WHATSAPP' }));
    const vencido = fila({ id: 900, estado: 'VENCIDO', ejecutar_en: new Date(Date.now() - 3600e3), fase_id: null });
    const deEstaFase = fila({ id: 901, estado: 'PENDIENTE', ejecutar_en: new Date(Date.now() + 3600e3), fase_id: 102 });
    const deOtraFase = fila({ id: 902, estado: 'PENDIENTE', ejecutar_en: new Date(Date.now() + 3600e3), fase_id: 103 });
    SeguimientoRecordatorio.findAll.mockResolvedValue([vencido, deEstaFase, deOtraFase]);
    const res = respuesta();

    await controller.completarFase(peticion(), res, jest.fn());

    expect(vencido.estado).toBe('COMPLETADO');
    expect(deEstaFase.estado).toBe('COMPLETADO');
    expect(deOtraFase.estado).toBe('PENDIENTE');
    expect(res.cuerpo.recordatorios_cumplidos).toEqual([900, 901]);
  });

  test('un pedido Pendiente pasa a En seguimiento al completar su primera fase', async () => {
    envio.estado = 'Pendiente';
    SeguimientoContacto.findOne.mockResolvedValueOnce(fila({ id: 1, estado: 'ABIERTO_EN_WHATSAPP' }));
    const res = respuesta();

    await controller.completarFase(peticion(), res, jest.fn());

    expect(envio.estado).toBe('EnSeguimiento');
    expect(res.cuerpo.pedido_paso_a_en_seguimiento).toBe(true);
  });

  test('abrir WhatsApp ya no cumple recordatorios ni avanza nada', async () => {
    WhatsappFlujoFase.findOne.mockReset().mockResolvedValue(FASE_2);
    SeguimientoContacto.create.mockResolvedValue({ id: 3 });
    const vencido = fila({ id: 900, estado: 'VENCIDO', ejecutar_en: new Date(Date.now() - 3600e3), fase_id: 102 });
    SeguimientoRecordatorio.findAll.mockResolvedValue([vencido]);
    const res = respuesta();

    await controller.registrarContacto(peticion({ fase_id: 102 }), res, jest.fn());

    expect(res.codigo).toBe(201);
    expect(SeguimientoContacto.create.mock.calls[0][0].estado).toBe('ABIERTO_EN_WHATSAPP');
    expect(vencido.estado).toBe('VENCIDO');
  });

  test('desmarcar devuelve la fase a "abierta" y el pedido vuelve a esa columna', async () => {
    const hecha = fila({ id: 1, estado: 'CONFIRMADO_POR_OPERADOR' });
    SeguimientoContacto.findAll.mockResolvedValue([hecha]);
    const res = respuesta();

    await controller.descompletarFase(peticion(), res, jest.fn());

    expect(res.codigo).toBe(204);
    expect(hecha.estado).toBe('ABIERTO_EN_WHATSAPP');
  });

  test('agendar eligiendo fase la guarda junto con su flujo', async () => {
    SeguimientoRecordatorio.findOne.mockResolvedValue(null);
    SeguimientoRecordatorio.create.mockImplementation(async (datos) => fila({ id: 905, version: 1, ...datos }));
    SeguimientoRecordatorio.update.mockResolvedValue([0]);
    const res = respuesta();

    await controller.programarRecordatorio(peticion({ horas: 4, fase_id: 102 }), res, jest.fn());

    expect(res.codigo).toBe(201);
    expect(SeguimientoRecordatorio.create.mock.calls[0][0]).toMatchObject({ envio_id: 50, fase_id: 102, flujo_id: 10 });
  });
});
