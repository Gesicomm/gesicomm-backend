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


test.each(['organico', 'campana'])('un contacto %s con productos de interés sigue siendo lead incluso si un cliente anterior manda es_lead=false', async tipo => {
  const r = res();
  await controller.createEnvio(req({ nombre_cliente: 'Consulta', telefono: '0981111222', origen: 'WHATSAPP', lead_tipo_manual: tipo, es_lead: false, monto: 50000, items: [{ producto_id: 10, cantidad: 1, precio_unitario: 50000 }] }), r);
  expect(r.status).toHaveBeenCalledWith(201);
  expect(models.Envio.create).toHaveBeenCalledWith(expect.objectContaining({ es_lead: true, numero_pedido: null, monto: 50000 }), expect.anything());
  expect(require('../../services/pedidoNumeracion.service').reservarNumeroPedido).not.toHaveBeenCalled();
  const creado = models.Envio.create.mock.calls[0][0];
  expect(creado.estado).toBe('Pendiente');
  expect(require('../../services/seguimiento/flujosBase').etapaDelPedido(creado)).toBe('SEGUIMIENTO_PRODUCTO_WHATSAPP');
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

test.each(['Pendiente', 'EnSeguimiento'])('elegir productos conserva el estado actual %s sin solicitar una transición', async estado => {
  Object.assign(lead, { estado, es_lead: true, numero_pedido: null, stock_descontado: false });
  const r = res();
  await controller.updateEstado(req({ items: [{ producto_id: 10, cantidad: 2, precio_unitario: 50000 }] }), r);
  expect(r.status).not.toHaveBeenCalled();
  expect(t.commit).toHaveBeenCalled();
  expect(t.rollback).not.toHaveBeenCalled();
  expect(lead.estado).toBe(estado);
  expect(lead.es_lead).toBe(true);
  expect(lead.numero_pedido).toBeNull();
  expect(lead.stock_descontado).toBe(false);
  expect(lead.items).toEqual([expect.objectContaining({ producto_id: 10, cantidad: 2 })]);
  expect(require('../../services/pedidoNumeracion.service').reservarNumeroPedido).not.toHaveBeenCalled();
});

test('elegir productos no habilita retroceder explícitamente de seguimiento a pendiente', async () => {
  Object.assign(lead, { estado: 'EnSeguimiento', es_lead: true });
  const r = res();
  await controller.updateEstado(req({ estado: 'Pendiente', items: [{ producto_id: 10, cantidad: 1, precio_unitario: 50000 }] }), r);
  expect(r.status).toHaveBeenCalledWith(400);
  expect(t.rollback).toHaveBeenCalled();
  expect(t.commit).not.toHaveBeenCalled();
});

test('reduce una cantidad web pendiente sin confirmar y recalcula el importe', async () => {
  Object.assign(lead, { origen: 'WEB', es_lead: false, costo_envio: 15000, items: [{ id: 5, producto_id: 10, cantidad: 2, precio_unitario: 615858 }] });
  const r = res();
  await controller.updateEstado(req({ monto: 1, items: [{ id: 5, producto_id: 10, cantidad: 1, precio_unitario: 615858 }] }), r);
  expect(r.status).not.toHaveBeenCalled();
  expect(lead.estado).toBe('Pendiente');
  expect(lead.monto).toBe(630858);
  expect(lead.items).toEqual([expect.objectContaining({ cantidad: 1, subtotal: 615858 })]);
  expect(require('../../services/speedbox/service').queueConfirmedOrder).not.toHaveBeenCalled();
  expect(t.commit).toHaveBeenCalled();
});

test('quita una línea y conserva la presentación y el origen comercial de la restante', async () => {
  Object.assign(lead, { origen: 'WEB', es_lead: false, items: [
    { id: 5, producto_id: 10, oferta_id: 9, oferta_nombre: 'Pack comprado', oferta_codigo: 'PACK-2', origen_venta: 'order_bump', componente_variante_id: 3, precio_normal: 100000 },
    { id: 6, producto_id: 11, cantidad: 2 },
  ] });
  models.Oferta.findAll.mockResolvedValueOnce([{ id: 9, producto_ancla_id: 10, nombre: 'Nombre editado', estrategia: 'normal' }]);
  const r = res();
  await controller.updateEstado(req({ items: [{ id: 5, producto_id: 10, oferta_id: 9, cantidad: 1, precio_unitario: 90000 }] }), r);
  expect(r.status).not.toHaveBeenCalled();
  expect(lead.items).toEqual([expect.objectContaining({ producto_id: 10, cantidad: 1, oferta_nombre: 'Pack comprado', origen_venta: 'order_bump', componente_variante_id: 3, precio_normal: 100000 })]);
  expect(lead.monto).toBe(90000);
  expect(models.EnvioItem.destroy).toHaveBeenCalledWith({ where: { envio_id: 100 }, transaction: t });
});

test.each([{ estado: 'Confirmado' }, { estado: 'Pendiente', stock_descontado: true }])('rechaza cambios de productos comprometidos: %j', async restricciones => {
  Object.assign(lead, { origen: 'WEB', ...restricciones });
  const r = res();
  await controller.updateEstado(req({ items: [{ producto_id: 10, cantidad: 1, precio_unitario: 50000 }] }), r);
  expect(r.status).toHaveBeenCalledWith(400);
  expect(models.EnvioItem.destroy).not.toHaveBeenCalled();
  expect(t.rollback).toHaveBeenCalled();
});

test('rechaza vaciar un pedido web y cantidades inválidas antes de borrar sus líneas', async () => {
  Object.assign(lead, { origen: 'WEB', es_lead: false });
  for (const items of [[], [{ producto_id: 10, cantidad: 0, precio_unitario: 50000 }], [{ producto_id: 10, cantidad: 1.5, precio_unitario: 50000 }]]) {
    const r = res();
    await controller.updateEstado(req({ items }), r);
    expect(r.status).toHaveBeenCalledWith(400);
  }
  expect(models.EnvioItem.destroy).not.toHaveBeenCalled();
});
