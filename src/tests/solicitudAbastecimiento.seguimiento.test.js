jest.mock('../models', () => ({
  sequelize: { transaction: jest.fn(), query: jest.fn() },
  SolicitudAbastecimiento: { create: jest.fn(), findOne: jest.fn(), findAndCountAll: jest.fn() },
  HistorialSolicitudAbastecimiento: { create: jest.fn() },
  SpeedboxPedido: { findOne: jest.fn() }, SpeedboxEvento: { findAll: jest.fn() },
  InventarioUbicacion: { findAll: jest.fn() },
  Producto: { findByPk: jest.fn() }, ProductoVariante: { findOne: jest.fn() },
  Deposito: { findOne: jest.fn() }, Usuario: {}, Rol: {},
}));
jest.mock('../services/tarifaDelivery.service', () => ({}));
jest.mock('../services/proveedorLogistico.service', () => ({}));
jest.mock('../services/comprobante.service', () => ({ procesarComprobanteParaR2: jest.fn() }));
jest.mock('../services/parametros.service', () => ({ obtenerVarios: jest.fn() }));
jest.mock('../services/inventarioUbicacion.service', () => ({ acreditar: jest.fn() }));
jest.mock('../services/producto.service', () => ({}));
jest.mock('../controllers/envioController', () => ({ costoParaComerciante: jest.fn(), esProductoCargadoPorAdmin: jest.fn() }));
jest.mock('../services/raha/service', () => ({}));
jest.mock('../services/speedbox/service', () => ({ environment: () => 'production', queueSupplyRequest: jest.fn() }));

const { Op } = require('sequelize');
const models = require('../models');
const servicio = require('../services/solicitudAbastecimiento.service');
const seguimiento = require('../services/abastecimiento/seguimientoRaha');
const inventario = require('../services/inventarioUbicacion.service');
const comprobante = require('../services/comprobante.service');
const parametros = require('../services/parametros.service');
const speedbox = require('../services/speedbox/service');

const solicitudBase = { id: 44, usuario_id: 7, producto_id: 3, variante_id: null, cantidad: 4,
  tipo_logistica: 'PROPIA', deposito_destino_id: 6, estado: 'proveedor_contactado', costo_producto: 80000,
  costo_logistico: 10000, pedidoRaha: { order_id: '900000000123456', status: 'en_camino' } };

beforeEach(() => {
  jest.clearAllMocks();
  models.sequelize.transaction.mockImplementation(callback => callback({}));
  models.SolicitudAbastecimiento.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
  models.InventarioUbicacion.findAll.mockResolvedValue([]);
  models.sequelize.query.mockResolvedValue([[]]);
});

test('filtra por estado remoto y tienda, con paginación y fechas antes de consultar los resultados', async () => {
  await servicio.listar({ usuario_id: 7, tiendaId: 12, vista: 'raha', estado: 'en_camino', depositoId: 6,
    page: 3, limit: 10, desde: '2026-10-01', hasta: '2026-10-18', ordenar: 'antiguos' });
  const consulta = models.SolicitudAbastecimiento.findAndCountAll.mock.calls[0][0];
  expect(consulta.where).toMatchObject({ usuario_id: 7, tipo_logistica: 'PROPIA', deposito_destino_id: 6, '$depositoDestino.tienda_id$': 12 });
  expect(consulta.where.estado).toBeUndefined();
  expect(consulta.where[Op.and][0].logic).toBe('en_camino');
  expect(consulta.where.created_at[Op.gte].toISOString()).toBe('2026-10-01T03:00:00.000Z');
  expect(consulta.where.created_at[Op.lte].toISOString()).toBe('2026-10-19T02:59:59.999Z');
  expect(consulta).toMatchObject({ limit: 10, offset: 20, subQuery: false, order: [['created_at', 'ASC'], ['id', 'ASC']] });
  expect(consulta.include.find(inclusion => inclusion.as === 'pedidoRaha')).toMatchObject({ where: { environment: 'production' }, required: false });
});

test('rechaza un rango de fechas invertido sin consultar pedidos', async () => {
  await expect(servicio.listar({ usuario_id: 7, vista: 'raha', desde: '2026-10-18', hasta: '2026-10-01' })).rejects.toThrow('fecha inicial');
  expect(models.SolicitudAbastecimiento.findAndCountAll).not.toHaveBeenCalled();
});

test('no interpreta los dígitos de un SKU como un ID local', async () => {
  await servicio.listar({ usuario_id: 7, vista: 'raha', texto: 'ABC123', page: 1 });
  const condiciones = models.SolicitudAbastecimiento.findAndCountAll.mock.calls[0][0].where[Op.or];
  expect(condiciones.some(condicion => condicion.id)).toBe(false);
  expect(condiciones.some(condicion => condicion['$producto.sku$'])).toBe(true);
});

test('el detalle muestra RAHA y stock del propietario, variante y depósito correctos sin pedir datos bancarios', async () => {
  models.SolicitudAbastecimiento.findOne.mockResolvedValue({ toJSON: () => ({ ...solicitudBase, historial: [] }) });
  models.InventarioUbicacion.findAll.mockResolvedValue([
    { usuario_id: 99, producto_id: 3, variante_id: null, deposito_id: 6, cantidad_disponible: 500 },
    { usuario_id: 7, producto_id: 3, variante_id: null, deposito_id: 6, cantidad_disponible: 9, cantidad_reservada: 2 },
  ]);
  models.sequelize.query.mockResolvedValue([[{ usuario_id: 7, producto_id: 3, variante_id: null, unidades: 5, importe: '150000' }]]);
  models.SpeedboxEvento.findAll.mockResolvedValue([{ id: 1, payload: { data: { status: 'en_camino', secret: 'privado' } }, occurred_at: '2026-10-18T12:00:00Z' }]);
  const respuesta = await servicio.obtener(44, { usuario_id: 7, tiendaId: 12 });
  expect(respuesta).toMatchObject({ estado_seguimiento: 'en_camino', es_raha: true, modalidad_pago: 'CONTRA_ENTREGA', precio_unitario: 20000,
    inventario: { disponible: 9, reservado: 2 }, ventas_producto: { unidades: 5 } });
  expect(respuesta.historial_raha[0]).toEqual({ id: 'raha-1', estado: 'en_camino', created_at: '2026-10-18T12:00:00Z', origen: 'RAHA' });
  expect(parametros.obtenerVarios).not.toHaveBeenCalled();
  expect(models.SpeedboxEvento.findAll.mock.calls[0][0].where).toMatchObject({ environment: 'production', usuario_id: 7, estado: 'procesado' });
});

test.each(['error', 'incierto'])('muestra revisión cuando el envío quedó %s sin estado remoto', estado => {
  expect(seguimiento.presentar({ ...solicitudBase, pedidoRaha: { estado } }).estado_seguimiento).toBe('requiere_revision');
});

test('crea abastecimientos contra entrega y encola RAHA sin esperar un comprobante', async () => {
  const cotizar = jest.spyOn(servicio, 'cotizar').mockResolvedValue({ cubierto: true, costoProducto: 80000, costoLogistico: 10000 });
  models.SolicitudAbastecimiento.create.mockImplementation(async datos => ({ id: 44, ...datos }));
  try {
    const solicitud = await servicio.crear({ usuario_id: 7, producto_id: 3, cantidad: 4, tipoLogistica: 'PROPIA', depositoId: 6 });
    expect(solicitud.estado).toBe('solicitado_raha');
    expect(models.HistorialSolicitudAbastecimiento.create.mock.calls[0][0].comentario).toContain('contra entrega');
    expect(speedbox.queueSupplyRequest).toHaveBeenCalledWith(solicitud, expect.anything());
  } finally { cotizar.mockRestore(); }
});

test('rechaza comprobantes RAHA antes de subir archivos', async () => {
  models.SolicitudAbastecimiento.findOne.mockResolvedValue({ ...solicitudBase, estado: 'pendiente_pago' });
  await expect(servicio.subirComprobante({ solicitud_id: 44, usuario_id: 7, fileData: {} })).rejects.toMatchObject({ status: 409 });
  expect(comprobante.procesarComprobanteParaR2).not.toHaveBeenCalled();
});

test('no acredita stock de pedidos que RAHA todavía no entregó', async () => {
  models.SolicitudAbastecimiento.findOne.mockResolvedValue(solicitudBase);
  models.SpeedboxPedido.findOne.mockResolvedValue({ status: 'en_camino' });
  await expect(servicio.confirmarRecepcionPropia({ solicitud_id: 44, usuario_id: 7 })).rejects.toMatchObject({ status: 409 });
  expect(inventario.acreditar).not.toHaveBeenCalled();
});

test('la recepción entregada acredita stock una sola vez aunque el comercio repita la confirmación', async () => {
  const solicitud = { ...solicitudBase, update: jest.fn(async function actualizar(datos) { Object.assign(this, datos); }) };
  const producto = { id: 3, stock_deposito: 2, cantidad_disponible: 2, update: jest.fn() };
  models.SolicitudAbastecimiento.findOne.mockResolvedValue(solicitud);
  models.SpeedboxPedido.findOne.mockResolvedValue({ status: 'entregado' });
  models.Producto.findByPk.mockResolvedValue(producto);
  await servicio.confirmarRecepcionPropia({ solicitud_id: 44, usuario_id: 7 });
  await servicio.confirmarRecepcionPropia({ solicitud_id: 44, usuario_id: 7 });
  expect(inventario.acreditar).toHaveBeenCalledTimes(1);
  expect(producto.update).toHaveBeenCalledWith({ stock_deposito: 6, cantidad_disponible: 6 }, expect.anything());
});
