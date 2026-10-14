'use strict';

// Ejercita filtros ANTES de paginar, datos de la fila y conteos sin tocar DB.
jest.mock('../models', () => ({
  sequelize: { query: jest.fn(async () => []) },
  Envio: { findAndCountAll: jest.fn(), findAll: jest.fn(async () => []), findOne: jest.fn(async () => null), count: jest.fn(async () => 0) },
  SpeedboxPedido: { findAll: jest.fn(async () => []) }, SpeedboxEvento: { findAll: jest.fn(async () => []) },
  Tienda: { findAll: jest.fn(async () => []) },
}));
jest.mock('../services/seguimiento/pendientesSeguimiento.service', () => ({ seguimientoDePedidos: jest.fn(async () => new Map()) }));
jest.mock('../services/pedidoIdentificador.service', () => ({ adjuntarIdentificadores: jest.fn(async rows => rows), filtroNumeroPedidoVisible: jest.fn() }));
jest.mock('../services/queue/seguimientoQueue', () => ({ encolarRecordatorio: jest.fn() }));
const { Op, Sequelize } = require('sequelize');
const { Envio, SpeedboxPedido } = require('../models');
const controller = require('../controllers/envioController');
const seguimiento = require('../services/seguimiento/pendientesSeguimiento.service');

function respuesta() {
  const res = { status: jest.fn(function () { return this; }), json: jest.fn() };
  return res;
}
const req = body => ({ usuario: { id: 7, rol: 'usuario', tiendaId: 9 }, body });

beforeEach(() => {
  jest.clearAllMocks();
  Envio.findAll.mockResolvedValue([]);
  SpeedboxPedido.findAll.mockResolvedValue([]);
});

test.each([
  ['pendiente_confirmacion', ['Preparado', 'Despachado', 'Reprogramado'], 'Preparado'],
  ['cargado', ['Preparado', 'Despachado', 'Reprogramado'], 'Despachado'],
  ['entregado', ['Entregado'], 'Entregado'],
])('la bandeja filtra RAHA %s por estado de seguimiento y lo adjunta a los mensajes', async (status, estados, efectivo) => {
  Envio.findAndCountAll.mockResolvedValue({ count: 1, rows: [{ id: 50, usuario_id: 7, tienda_id: 9, estado: 'Confirmado', telefono: '0981111111', monto: 150000 }] });
  SpeedboxPedido.findAll.mockResolvedValue([{ envio_id: 50, order_id: '54', estado: 'enviado', status, environment: 'production' }]);
  const res = respuesta();
  await controller.listEnviosPaginados(req({ estados, seguimiento_comercial: true, incluir_seguimiento: true }), res);
  expect(res.status).not.toHaveBeenCalled();
  const options = Envio.findAndCountAll.mock.calls[0][0];
  expect(options.where).toMatchObject({ usuario_id: 7, tienda_id: 9 });
  expect(options.where.estado).toBeUndefined();
  const filtro = options.where[Op.and][0];
  expect(filtro.logic[Op.in]).toEqual(estados);
  expect(filtro.attribute.val).toContain('speedbox_pedidos');
  // Sequelize arma la consulta con el filtro antes de LIMIT/OFFSET.
  const db = new Sequelize('postgres://unused:unused@localhost/unused', { logging: false });
  const sql = db.dialect.queryGenerator.selectQuery('envios', { attributes: ['id'], where: options.where, limit: 10 }, { name: 'Envio' });
  expect(sql).toContain('sp.usuario_id = "Envio"."usuario_id"');
  expect(sql.indexOf('WHERE')).toBeLessThan(sql.indexOf('LIMIT 10'));
  const data = res.json.mock.calls[0][0].data;
  expect(data[0]).toMatchObject({ estado: 'Confirmado', estado_seguimiento: efectivo, raha_logistica: { gestionado: true, status } });
  expect(seguimiento.seguimientoDePedidos.mock.calls[0][0].pedidos[0]).toMatchObject({ estado_seguimiento: efectivo });
});

test('los contadores suman despacho local y RAHA, y separan el pendiente y el tránsito de la leyenda', async () => {
  Envio.findAll.mockResolvedValue([
    { estado: 'Preparado', cantidad: '2', raha_status: null },
    { estado: 'Preparado', cantidad: '1', raha_status: 'pendiente_confirmacion' },
    { estado: 'Despachado', cantidad: '3', raha_status: null },
    { estado: 'Despachado', cantidad: '2', raha_status: 'cargado' },
    { estado: 'Despachado', cantidad: '1', raha_status: 'en_camino' },
  ]);
  const res = respuesta();
  await controller.conteoPorEstado(req({ seguimiento_comercial: true }), res);
  expect(res.status).not.toHaveBeenCalled();
  expect(res.json.mock.calls[0][0]).toMatchObject({ Preparado: 3, Despachado: 6, Reprogramado: 0, raha_pendiente_confirmacion: 1, raha_en_camino: 1 });
  expect(Envio.findAll.mock.calls[0][0].attributes[0][0].val).toContain('speedbox_pedidos');
});

test('Logística sigue filtrando por estado local para sus operaciones de stock', async () => {
  Envio.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
  await controller.listEnviosPaginados(req({ estados: ['Confirmado'], excluir_logistica_raha: true }), respuesta());
  expect(Envio.findAndCountAll.mock.calls[0][0].where.estado[Op.in]).toEqual(['Confirmado']);
});

test('el listado usado para refrescar paneles conserva los estados de RAHA', async () => {
  Envio.findAll.mockResolvedValue([{ id: 50, estado: 'Confirmado', usuario_id: 7 }]);
  SpeedboxPedido.findAll.mockResolvedValue([{ envio_id: 50, order_id: '54', estado: 'enviado', status: 'cargado' }]);
  const res = respuesta();
  await controller.listEnvios(req({}), res);
  expect(res.status).not.toHaveBeenCalled();
  expect(res.json.mock.calls[0][0][0]).toMatchObject({ estado: 'Confirmado', raha_logistica: { gestionado: true, status: 'cargado' } });
});
