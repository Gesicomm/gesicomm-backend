const mockQuery = jest.fn();

jest.mock('../models', () => ({
  Envio: {
    sum: jest.fn(),
    count: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    sequelize: {
      query: mockQuery,
      fn: jest.fn((name, ...args) => ({ fn: name, args })),
      col: jest.fn(name => ({ col: name })),
    },
  },
  EnvioItem: { findAll: jest.fn(), findAndCountAll: jest.fn() },
  EnvioItemComponente: {},
  Producto: {},
  Oferta: {},
  Usuario: {},
  ProductoVariante: {},
  MetodoPago: {},
  Courier: {},
}));

const ReporteService = require('../services/reporteService');
const { Envio, EnvioItem } = require('../models');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reporte de upsell cerrado', () => {
  it('incluye el upsell entregado en KPIs planos y venta incremental', async () => {
    Envio.sum.mockResolvedValue(289000);
    Envio.count
      .mockResolvedValueOnce(1) // total pedidos
      .mockResolvedValueOnce(1) // pedidos concretados
      .mockResolvedValueOnce(1) // clientes únicos
      .mockResolvedValueOnce(0); // cancelados/devueltos
    Envio.findAll.mockResolvedValue([{ estado: 'Entregado', total: '1' }]);
    mockQuery
      .mockResolvedValueOnce([[{ unidades: '2' }]])
      .mockResolvedValueOnce([[
        { origen_venta: 'normal', lineas: '1', unidades: '1', importe_cobrado: '169000', importe_normal: '169000' },
        { origen_venta: 'upsell', lineas: '1', unidades: '1', importe_cobrado: '120000', importe_normal: '170000' },
      ]]);

    const kpis = await ReporteService.obtenerKPIs(5, {});

    expect(kpis.ventas_totales).toBe(289000);
    expect(kpis.pedidos).toBe(1);
    expect(kpis.ventas_normales).toBe(1);
    expect(kpis.upsells).toBe(1);
    expect(kpis.importe_incremental).toBe(120000);
    expect(kpis.descuento_incremental).toBe(50000);
    expect(kpis.por_origen.upsell).toMatchObject({
      lineas: 1,
      unidades: 1,
      importe_cobrado: 120000,
      importe_normal: 170000,
      descuento_concedido: 50000,
    });
  });

  it('incluye una venta de combo de catálogo como bundle en KPIs', async () => {
    Envio.sum.mockResolvedValue(288000);
    Envio.count
      .mockResolvedValueOnce(1) // total pedidos
      .mockResolvedValueOnce(1) // pedidos concretados
      .mockResolvedValueOnce(1) // clientes únicos
      .mockResolvedValueOnce(0); // cancelados/devueltos
    Envio.findAll.mockResolvedValue([{ estado: 'Entregado', total: '1' }]);
    mockQuery
      .mockResolvedValueOnce([[{ unidades: '1' }]])
      .mockResolvedValueOnce([[
        { origen_venta: 'combo', lineas: '1', unidades: '1', importe_cobrado: '288000', importe_normal: '288000' },
      ]]);

    const kpis = await ReporteService.obtenerKPIs(5, {});

    expect(kpis.ventas_totales).toBe(288000);
    expect(kpis.bundles).toBe(1);
    expect(kpis.importe_incremental).toBe(288000);
    expect(kpis.por_origen.combo).toMatchObject({
      lineas: 1,
      unidades: 1,
      importe_cobrado: 288000,
      importe_normal: 288000,
      descuento_concedido: 0,
    });
  });

  it('el reporte cross-selling arma el par producto + upsell solo con pedidos Entregado', async () => {
    EnvioItem.findAll.mockResolvedValue([
      {
        envio_id: 1,
        producto_id: 10,
        nombre_producto: 'AdelFit',
        subtotal: 169000,
        Envio: { estado: 'Entregado', monto: 289000 },
        Producto: { nombre: 'AdelFit' },
      },
      {
        envio_id: 1,
        producto_id: 20,
        nombre_producto: 'Articumina',
        subtotal: 120000,
        Envio: { estado: 'Entregado', monto: 289000 },
        Producto: { nombre: 'Articumina' },
      },
      {
        envio_id: 2,
        producto_id: 10,
        nombre_producto: 'AdelFit',
        subtotal: 169000,
        Envio: { estado: 'Pendiente', monto: 289000 },
        Producto: { nombre: 'AdelFit' },
      },
      {
        envio_id: 2,
        producto_id: 20,
        nombre_producto: 'Articumina',
        subtotal: 120000,
        Envio: { estado: 'Pendiente', monto: 289000 },
        Producto: { nombre: 'Articumina' },
      },
    ]);

    const reporte = await ReporteService.obtenerReporteCrossSelling(5, 1, 10, {});

    expect(reporte.total).toBe(1);
    expect(reporte.kpis.pedidos_exitosos_analizados).toBe(1);
    expect(reporte.data[0]).toMatchObject({
      producto_a: 'AdelFit',
      producto_b: 'Articumina',
      pedidos_juntos: 1,
      ventas_pedidos_combinados: 289000,
    });
  });
});
