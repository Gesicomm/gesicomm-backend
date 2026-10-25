/**
 * Ficha del módulo Clientes: pedidos de un cliente por la clave del reporte
 * (teléfono normalizado), siempre dentro de la tienda activa.
 */
const mockFindAll = jest.fn();
jest.mock('../models', () => ({
  Envio: { findAll: (...a) => mockFindAll(...a), sequelize: { where: (izq, der) => ({ izq, der }) } },
  EnvioItem: {},
}));
jest.mock('../services/pedidoIdentificador.service', () => ({
  adjuntarIdentificadores: jest.fn(async (envios) => envios.map(e => ({ ...e, numero_pedido_visible: `sommix-${e.id}` }))),
  filtroNumeroPedidoVisible: jest.fn(),
  sqlReferenciaPedido: jest.fn(() => ({})),
}));

const ReporteService = require('../services/reporteService');

beforeEach(() => mockFindAll.mockReset());

test('trae los pedidos del cliente en la tienda activa, sin leads', async () => {
  mockFindAll.mockResolvedValue([{ id: 1047, estado: 'Pendiente' }]);
  const r = await ReporteService.obtenerPedidosCliente(7, 'TEL:595992820631', { tienda_id: 69 });
  expect(r.pedidos).toEqual([{ id: 1047, estado: 'Pendiente', numero_pedido_visible: 'sommix-1047' }]);
  const [opciones] = mockFindAll.mock.calls[0];
  expect(opciones.where).toMatchObject({ usuario_id: 7, es_lead: false, tienda_id: 69 });
  const condicion = Object.getOwnPropertySymbols(opciones.where).map(s => opciones.where[s])[0][0];
  expect(condicion.der).toBe('TEL:595992820631');
  expect(String(condicion.izq.val)).toContain("'TEL:'");
  expect(opciones.limit).toBe(50);
});

test('rechaza claves que no salen del reporte', async () => {
  for (const mala of [undefined, '', "TEL:1' OR '1'='1", 'OTRA:1', 'TEL:12']) {
    await expect(ReporteService.obtenerPedidosCliente(7, mala, {})).rejects.toMatchObject({ status: 400 });
  }
  expect(mockFindAll).not.toHaveBeenCalled();
});
