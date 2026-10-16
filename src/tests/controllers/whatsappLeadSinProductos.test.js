'use strict';
const t = { commit: jest.fn(), rollback: jest.fn() };
const models = {
  sequelize: { transaction: jest.fn(async () => t) },
  Envio: { create: jest.fn(), findOne: jest.fn(), findByPk: jest.fn() },
  EnvioItem: { bulkCreate: jest.fn(async items => items), destroy: jest.fn() },
  Producto: { findAll: jest.fn() }, ProductoVariante: { count: jest.fn(async () => 0) },
  Oferta: { findAll: jest.fn(async () => []) },
};
jest.doMock('../../models', () => models);
for (const name of ['pedidosAnalyticsService', 'seguimiento/pendientesSeguimiento.service', 'producto.service', 'stockPorTienda.service', 'abastecimiento/abastecimientoFlujo.service', 'tarifaDelivery.service', 'proveedorLogistico.service', 'payments/pagoParService']) {
  jest.doMock('../../services/' + name, () => ({}));
}
jest.doMock('../../utils/historial', () => ({ registrarHistorial: jest.fn() }));
jest.doMock('../../services/metaCampanaLeads.service', () => ({ registrarLeadsDeCampana: jest.fn() }));
jest.doMock('../../services/pedidoNumeracion.service', () => ({ reservarNumeroPedido: jest.fn(async () => 1), reservarNumeroPedidoTienda: jest.fn(async () => 1) }));
jest.doMock('../../services/pedidoIdentificador.service', () => ({ adjuntarIdentificadores: async rows => rows }));
jest.doMock('../../services/speedbox/service', () => ({ assertCanChange: jest.fn(), queueConfirmedOrder: jest.fn() }));
const controller = require('../../controllers/envioController');
let lead;
beforeEach(() => {
  jest.clearAllMocks();
  lead = { id: 100, usuario_id: 7, estado: 'Pendiente', origen: 'WHATSAPP', items: [], monto: 0, update: jest.fn(async data => Object.assign(lead, data)) };
  models.Envio.findOne.mockResolvedValue(lead);
  models.Envio.findByPk.mockImplementation(async () => lead);
  models.Envio.create.mockImplementation(async data => ({ ...lead, ...data }));
  models.Producto.findAll.mockResolvedValue([{ id: 10, nombre: 'Silla' }]);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
const req = body => ({ usuario: { id: 7, tenantId: 2, tiendaId: 9 }, params: { id: 100 }, body });
const res = () => { const r = { json: jest.fn() }; r.status = jest.fn(() => r); return r; };

test.each(['organico', 'campana'])('crea lead %s sin productos ni reserva de stock', async tipo => {
  const r = res();
  await controller.createEnvio(req({ nombre_cliente: 'Consulta', telefono: '0981111222', origen: 'WHATSAPP', lead_tipo_manual: tipo, items: [] }), r);
  expect(r.status).toHaveBeenCalledWith(201);
  expect(models.Envio.create).toHaveBeenCalledWith(expect.objectContaining({ estado: 'Pendiente', estado_comercial: 'Pendiente', monto: 0, items: [], lead_tipo_manual: tipo, es_lead: true, numero_pedido: null, numero_pedido_tienda: null }), expect.anything());
  expect(t.commit).toHaveBeenCalled();
  expect(lead.update).not.toHaveBeenCalled();
});
test('agrega productos al mismo lead y calcula el importe en el servidor', async () => {
  const r = res();
  await controller.updateEstado(req({ estado: 'Pendiente', monto: 1, lead_tipo_manual: 'campana', items: [{ producto_id: 10, cantidad: 2, precio_unitario: 50000 }] }), r);
  expect(models.EnvioItem.bulkCreate).toHaveBeenCalledWith([expect.objectContaining({ envio_id: 100, producto_id: 10, subtotal: 100000 })], { transaction: t });
  expect(lead.update).toHaveBeenCalledWith(expect.objectContaining({ monto: 100000, lead_tipo_manual: 'campana' }), { transaction: t });
  expect(t.commit).toHaveBeenCalled();
  expect(t.rollback).not.toHaveBeenCalled();
});
test('rechaza productos ajenos al tenant', async () => {
  models.Producto.findAll.mockResolvedValue([]);
  const r = res();
  await controller.updateEstado(req({ estado: 'Pendiente', items: [{ producto_id: 10, cantidad: 1, precio_unitario: 50000 }] }), r);
  expect(r.status).toHaveBeenCalledWith(400);
  expect(models.EnvioItem.bulkCreate).not.toHaveBeenCalled();
  expect(t.rollback).toHaveBeenCalled();
});
test('impide confirmar un lead que todavía no eligió productos', async () => {
  const r = res();
  await controller.updateEstado(req({ estado: 'Confirmado' }), r);
  expect(r.status).toHaveBeenCalledWith(400);
  expect(lead.update).not.toHaveBeenCalled();
  expect(t.rollback).toHaveBeenCalled();
});


test('un contacto orgánico con productos de interés sigue siendo lead', async () => {
  const r = res();
  await controller.createEnvio(req({ nombre_cliente: 'Consulta', telefono: '0981111222', origen: 'WHATSAPP', lead_tipo_manual: 'organico', es_lead: true, monto: 50000, items: [{ producto_id: 10, cantidad: 1, precio_unitario: 50000 }] }), r);
  expect(r.status).toHaveBeenCalledWith(201);
  expect(models.Envio.create).toHaveBeenCalledWith(expect.objectContaining({ es_lead: true, numero_pedido: null, monto: 50000 }), expect.anything());
  expect(require('../../services/pedidoNumeracion.service').reservarNumeroPedido).not.toHaveBeenCalled();
});


test('al confirmar convierte el lead y reserva su numeración por primera vez', async () => {
  Object.assign(lead, { es_lead: true, numero_pedido: null, numero_pedido_tienda: null, stock_descontado: true, items: [{ producto_id: 10, cantidad: 1 }] });
  const r = res();
  await controller.updateEstado(req({ estado: 'Confirmado' }), r);
  expect(t.rollback).not.toHaveBeenCalled();
  expect(lead.update).toHaveBeenCalledWith(expect.objectContaining({ es_lead: false, numero_pedido: 1, numero_pedido_tienda: 1, estado: 'Confirmado' }), { transaction: t });
  expect(require('../../services/pedidoNumeracion.service').reservarNumeroPedido).toHaveBeenCalledWith(7, t);
});


test('puede reemplazar los productos de interés antes de confirmar, sin duplicarlos', async () => {
  lead.items = [{ id: 55, producto_id: 5, cantidad: 1 }];
  const r = res();
  await controller.updateEstado(req({ estado: 'Pendiente', costo_envio: 20000, delivery_a_cargo: 'cliente', items: [{ producto_id: 10, cantidad: 2, precio_unitario: 50000 }] }), r);
  expect(models.EnvioItem.destroy).toHaveBeenCalledWith({ where: { envio_id: 100 }, transaction: t });
  expect(lead.update).toHaveBeenCalledWith(expect.objectContaining({ monto: 120000 }), { transaction: t });
  expect(t.rollback).not.toHaveBeenCalled();
});

test('no permite reemplazar productos con stock ya reservado', async () => {
  lead.stock_descontado = true;
  const r = res();
  await controller.updateEstado(req({ estado: 'Pendiente', items: [{ producto_id: 10, cantidad: 1, precio_unitario: 50000 }] }), r);
  expect(r.status).toHaveBeenCalledWith(400);
  expect(models.EnvioItem.destroy).not.toHaveBeenCalled();
});
