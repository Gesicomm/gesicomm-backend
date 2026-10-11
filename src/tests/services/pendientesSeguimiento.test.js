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
  Envio: { findOne: jest.fn(), findAll: jest.fn() },
  EnvioItem: { findAll: jest.fn() },
  WhatsappFlujo: { findAll: jest.fn() },
  WhatsappFlujoFase: { findOne: jest.fn() },
  EnvioEtiqueta: { findOne: jest.fn(), create: jest.fn() },
  SeguimientoContacto: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn(), count: jest.fn() },
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
const abierta = (envio_id, fase_id, haceHoras, flujo_id = 10) => ({
  envio_id, flujo_id, fase_id, estado: 'ABIERTO_EN_WHATSAPP', veces: '1', ultimo: enHoras(-haceHoras),
});
const completada = (envio_id, fase_id, haceHoras, flujo_id = 10) => ({
  envio_id, flujo_id, fase_id, estado: 'CONFIRMADO_POR_OPERADOR', veces: '1', ultimo: enHoras(-haceHoras),
});

function armar({ pedidos, recordatorios = [], contactos = [], flujos = [FLUJO, FLUJO_WHATSAPP] }) {
  return servicio.armarPendientes({ pedidos, recordatorios, contactos, flujos, ahora: AHORA });
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

  test('pedido que entró por WhatsApp usa el flujo de ese origen', () => {
    const [item] = armar({ pedidos: [pedido(1, { origen: 'WHATSAPP' })] });

    expect(item).toMatchObject({ flujo_id: 20, fase_id: 201 });
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
    const tablero = servicio.armarTablero(items(), [FLUJO, FLUJO_WHATSAPP], { limit: 10 });

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

  test('sin nada pendiente muestra el flujo predeterminado con sus columnas en cero', () => {
    const tablero = servicio.armarTablero([], [FLUJO_WHATSAPP, FLUJO], {});

    expect(tablero.flujo_id).toBe(10);
    expect(tablero.columnas.map((c) => c.total)).toEqual([0, 0, 0]);
  });
});

describe('tableroDeSeguimiento', () => {
  test('respeta el alcance, deja afuera los pedidos cerrados y solo busca productos de lo que devuelve', async () => {
    Envio.findAll.mockResolvedValue(Array.from({ length: 12 }, (_, i) => pedido(i + 1)));
    WhatsappFlujo.findAll.mockResolvedValue([FLUJO]);
    SeguimientoRecordatorio.findAll.mockResolvedValue([]);
    SeguimientoContacto.findAll.mockResolvedValue([]);
    EnvioItem.findAll.mockResolvedValue([{ envio_id: 1, nombre_producto: 'Mancuerna 5kg', cantidad: 2 }]);

    const res = await servicio.tableroDeSeguimiento({
      whereBase: { usuario_id: 7, tienda_id: 9 }, usuarioId: 7, esAdmin: false, ahora: AHORA, filtros: { limit: 5 },
    });

    const { where } = Envio.findAll.mock.calls[0][0];
    expect(where.usuario_id).toBe(7);
    expect(where.tienda_id).toBe(9);
    expect(where[Op.and][0].estado[Op.notIn]).toEqual(['Entregado', 'Cancelado', 'Devuelto', 'Perdido']);

    expect(res.columnas[0].total).toBe(12);
    expect(res.columnas[0].data).toHaveLength(5);
    // Productos: solo de las 5 tarjetas de la página, no de los 12 pedidos.
    expect(EnvioItem.findAll.mock.calls[0][0].where.envio_id[Op.in]).toHaveLength(5);
    expect(res.columnas[0].data.find((i) => i.envio_id === 1).productos).toBe('Mancuerna 5kg x2');
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

  test('la apertura pendiente pasa a completada y devuelve la fase siguiente', async () => {
    const apertura = fila({ id: 1, estado: 'ABIERTO_EN_WHATSAPP' });
    SeguimientoContacto.findOne.mockResolvedValueOnce(apertura);
    const res = respuesta();

    await controller.completarFase(peticion(), res, jest.fn());

    expect(apertura.estado).toBe('CONFIRMADO_POR_OPERADOR');
    expect(SeguimientoContacto.create).not.toHaveBeenCalled();
    expect(res.cuerpo.siguiente_fase).toMatchObject({ id: 103, orden: 3, espera_sugerida_minutos: 1440 });
    // El pedido se busca dentro de la cuenta y la tienda activa.
    expect(Envio.findOne.mock.calls[0][0].where).toEqual({ id: '50', usuario_id: 7, tienda_id: 9 });
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
