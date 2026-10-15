jest.mock('../../models', () => {
  const { Sequelize } = require('sequelize');
  return {
    Tienda: { findAll: jest.fn(async () => [{ id: 9, usuario_id: 7, nombre: 'Alibaguay' }]) },
    Envio: { findAndCountAll: jest.fn(), findAll: jest.fn(), sequelize: Sequelize },
    EnvioItem: { findAndCountAll: jest.fn() },
  };
});

const { Envio, EnvioItem } = require('../../models');
const Reportes = require('../../services/reporteService');
const { resolverMensaje, listarVariablesDisponibles } = require('../../services/seguimiento/plantillaResolver.service');
const pedido = { id: 4, usuario_id: 7, tienda_id: 9, numero_pedido: 4, numero_pedido_tienda: 2,
  tienda_nombre: 'Alibaguay', monto: 100000, estado: 'Entregado', comision_pct_aplicada: 5 };
const fila = { toJSON: () => ({ ...pedido }) };

beforeEach(() => {
  jest.clearAllMocks();
  Envio.findAndCountAll.mockResolvedValue({ count: 1, rows: [fila] });
  Envio.findAll.mockResolvedValue([pedido]);
});

test('todos los alias de WhatsApp usan ALI-1002', () => {
  expect(resolverMensaje('Pedido {pedido_id} / {{numero_pedido}} / {pedido}', pedido)).toBe('Pedido ALI-1002 / ALI-1002 / ALI-1002');
});

test('el catálogo de la vista previa muestra el mismo formato que el mensaje real', () => {
  const variable = listarVariablesDisponibles().find(v => v.key === 'pedido_id');
  expect(variable.ejemplo).toBe('MIT-1001');
  expect(variable.ejemplo).toBe(resolverMensaje('{pedido_id}', {
    tienda_nombre: 'Mi tienda', tienda_id: 9, numero_pedido_tienda: 1,
  }));
});

test('pedidos, comisiones y facturación comparten la referencia por tienda', async () => {
  const pedidos = await Reportes.obtenerPedidos(7);
  const comisiones = await Reportes.obtenerReporteComisiones(7);
  const facturas = await Reportes.obtenerReporteFacturacion(7);
  expect(pedidos.pedidos[0].numero_pedido_visible).toBe('ALI-1002');
  expect(comisiones.data[0].numero_pedido_visible).toBe('ALI-1002');
  expect(facturas.data[0].numero_pedido_visible).toBe('ALI-1002');
  expect(comisiones.data[0].costo_comision).toBe(5000);
});

test('el reporte de ítems conserva el id técnico y devuelve la referencia para mostrar', async () => {
  EnvioItem.findAndCountAll.mockResolvedValue({ count: 1, rows: [{ toJSON: () => ({ id: 88, envio_id: 4, Envio: pedido }) }] });
  const reporte = await Reportes.obtenerItemsVendidos(7, 1, 10, { buscador: 'ALI-1002' });
  expect(reporte.items[0]).toMatchObject({ envio_id: 4, Envio: { id: 4, numero_pedido_visible: 'ALI-1002' } });
});
