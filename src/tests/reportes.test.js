/**
 * ReporteService — reportes de ventas.
 *
 * Antes esto era un test de integración: creaba un inquilino, un usuario,
 * un producto, un envío, su item y su componente en Postgres, y los
 * borraba al final. Esa base es la de PRODUCCIÓN detrás de un túnel (ver
 * src/config/database): con el túnel abajo la suite fallaba entera, y con
 * el túnel arriba insertaba y borraba filas reales.
 *
 * Ahora los modelos se simulan y devuelven las mismas filas que devolvía
 * ese fixture. Lo que se verifica es la lógica JS del servicio, que es
 * donde está el riesgo real: clasificación por estado, costo del
 * comerciante desde el snapshot de componentes (y su respaldo), unitarios
 * derivados, orden, paginación y KPIs.
 *
 * QUEDA FUERA DE COBERTURA lo que antes sí se ejercitaba de rebote: que
 * las consultas SQL (SUM, GROUP BY, los include) devuelvan eso. Para
 * cubrirlo hace falta una base de pruebas propia, que hoy el proyecto no
 * tiene.
 */

const mockQuery = jest.fn();

jest.mock('../models', () => ({
  Envio: {
    sum: jest.fn(),
    count: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    sequelize: {
      query: mockQuery,
      QueryTypes: { SELECT: 'SELECT' },
    },
  },
  EnvioItem: { findAll: jest.fn(), findAndCountAll: jest.fn() },
  EnvioItemComponente: {},
  Producto: {},
  Oferta: {},
  Usuario: {},
}));

const ReporteService = require('../services/reporteService');
const { Envio, EnvioItem } = require('../models');

const USUARIO = 1;
const PERIODO = { fecha_desde: '2026-08-01', fecha_hasta: '2026-08-31' };

/** Fila con .toJSON(), como la instancia que devuelve Sequelize. */
const instancia = (datos) => ({ ...datos, toJSON: () => ({ ...datos }) });

/** El mismo pedido del fixture viejo: 2 unidades a 150.000, entregado. */
const itemEntregado = (extra = {}) => ({
  producto_id: 10,
  nombre_producto: 'Test Report Product',
  cantidad: 2,
  precio_unitario: 150000,
  subtotal: 300000,
  Envio: { estado: 'Entregado' },
  Producto: { precio_costo: 50000, precio_base: 70000 },
  componentes_vendidos: [{ cantidad: 2, costo_unitario: 50000 }],
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('obtenerKPIs', () => {
  it('calcula ventas, pedidos y ticket promedio', async () => {
    Envio.sum.mockResolvedValue(300000);
    Envio.count.mockResolvedValue(1);
    mockQuery.mockResolvedValue([]);

    const kpis = await ReporteService.obtenerKPIs(USUARIO, PERIODO);

    expect(kpis.ventas_totales).toBe(300000);
    expect(kpis.pedidos).toBe(1);
    expect(kpis.ticket_promedio).toBe(300000);
  });

  it('no divide por cero cuando no hay pedidos', async () => {
    Envio.sum.mockResolvedValue(null);
    Envio.count.mockResolvedValue(0);
    mockQuery.mockResolvedValue([]);

    const kpis = await ReporteService.obtenerKPIs(USUARIO, PERIODO);

    expect(kpis.ventas_totales).toBe(0);
    expect(kpis.ticket_promedio).toBe(0);
  });

  it('acota por usuario, estado entregado y rango de fechas', async () => {
    Envio.sum.mockResolvedValue(0);
    Envio.count.mockResolvedValue(0);
    mockQuery.mockResolvedValue([]);

    await ReporteService.obtenerKPIs(USUARIO, PERIODO);

    const { where } = Envio.sum.mock.calls[0][1];
    expect(where).toMatchObject({ usuario_id: USUARIO, estado: 'Entregado' });
    expect(where.fecha).toBeDefined();
  });

  it('separa los canales de venta y el descuento que costó cada uno', async () => {
    // El descuento del order bump es la diferencia entre lo que se habría
    // cobrado a precio normal y lo que se cobró de verdad.
    Envio.sum.mockResolvedValue(300000);
    Envio.count.mockResolvedValue(1);
    mockQuery.mockResolvedValue([
      { origen_venta: 'normal', lineas: '2', unidades: '3', importe_cobrado: '450000', importe_normal: '450000' },
      { origen_venta: 'order_bump', lineas: '1', unidades: '1', importe_cobrado: '80000', importe_normal: '100000' },
      { origen_venta: 'combo', lineas: '1', unidades: '2', importe_cobrado: '150000', importe_normal: '180000' },
      { origen_venta: 'upsell', lineas: '1', unidades: '1', importe_cobrado: '60000', importe_normal: '60000' },
    ]);

    const kpis = await ReporteService.obtenerKPIs(USUARIO, PERIODO);

    expect(kpis.ventas_normales).toBe(3);
    expect(kpis.order_bumps).toBe(1);
    expect(kpis.bundles).toBe(2);
    expect(kpis.upsells).toBe(1);

    // order_bump + combo son las ofertas del checkout.
    expect(kpis.importe_incremental).toBe(80000 + 150000);
    expect(kpis.descuento_incremental).toBe(20000 + 30000);

    expect(kpis.por_origen.order_bump).toMatchObject({
      lineas: 1, unidades: 1, importe_cobrado: 80000, importe_normal: 100000, descuento_concedido: 20000,
    });
  });

  it('trata una fila sin origen como venta normal', async () => {
    Envio.sum.mockResolvedValue(0);
    Envio.count.mockResolvedValue(0);
    mockQuery.mockResolvedValue([
      { origen_venta: null, lineas: '1', unidades: '4', importe_cobrado: '100', importe_normal: '100' },
    ]);

    const kpis = await ReporteService.obtenerKPIs(USUARIO, PERIODO);
    expect(kpis.ventas_normales).toBe(4);
  });
});

describe('obtenerPedidos', () => {
  it('devuelve la página de pedidos con su total', async () => {
    Envio.findAndCountAll.mockResolvedValue({
      count: 1,
      rows: [{ id: 5, monto: 300000, cliente: 'John Doe', estado: 'Entregado' }],
    });

    const reporte = await ReporteService.obtenerPedidos(USUARIO, 1, 10, PERIODO);

    expect(reporte.total).toBe(1);
    expect(reporte.pedidos).toHaveLength(1);
    expect(reporte.pedidos[0]).toMatchObject({ monto: 300000, cliente: 'John Doe' });
  });

  it('traduce página y límite a limit/offset', async () => {
    Envio.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

    await ReporteService.obtenerPedidos(USUARIO, 3, 10, PERIODO);

    expect(Envio.findAndCountAll.mock.calls[0][0]).toMatchObject({ limit: 10, offset: 20 });
  });
});

describe('obtenerItemsVendidos', () => {
  it('devuelve los items con su total', async () => {
    EnvioItem.findAndCountAll.mockResolvedValue({
      count: 1,
      rows: [{ nombre_producto: 'Test Report Product', cantidad: 2, subtotal: 300000 }],
    });

    const reporte = await ReporteService.obtenerItemsVendidos(USUARIO, 1, 10, PERIODO);

    expect(reporte.total).toBe(1);
    expect(reporte.items[0]).toMatchObject({ nombre_producto: 'Test Report Product', cantidad: 2 });
  });
});

describe('obtenerReporteProductos', () => {
  it('arma la fila del producto y la deja cerrada sola', async () => {
    EnvioItem.findAll.mockResolvedValue([itemEntregado()]);

    const reporte = await ReporteService.obtenerReporteProductos(USUARIO, 1, 10, PERIODO);

    expect(reporte.total).toBe(1);
    expect(reporte.data).toHaveLength(1);
    expect(reporte.data[0]).toMatchObject({
      nombre: 'Test Report Product',
      vendidos: 2,
      venta_total: 300000,
      costo_total: 100000,   // snapshot: 50.000 x 2
      ingresos: 200000,
      precio_venta_unitario: 150000,
      precio_costo_unitario: 50000,
    });
    expect(reporte.kpis.total_ingresos).toBe(200000);
    expect(reporte.kpis.total_unidades).toBe(2);
    expect(reporte.kpis.producto_estrella).toBe('Test Report Product');
  });

  it('sin snapshot de componentes cae a precio_base, no a precio_costo', async () => {
    // `precio_costo` es lo que le costó al ADMIN y el comerciante nunca lo
    // paga: usarlo acá infla el margen.
    EnvioItem.findAll.mockResolvedValue([itemEntregado({ componentes_vendidos: [] })]);

    const reporte = await ReporteService.obtenerReporteProductos(USUARIO, 1, 10, PERIODO);

    expect(reporte.data[0].costo_total).toBe(140000); // precio_base 70.000 x 2
    expect(reporte.data[0].ingresos).toBe(160000);
  });

  it('clasifica devoluciones y cancelados sin contarlos como venta', async () => {
    EnvioItem.findAll.mockResolvedValue([
      itemEntregado(),
      itemEntregado({ Envio: { estado: 'Devuelto' }, cantidad: 1 }),
      itemEntregado({ Envio: { estado: 'Cancelado' }, cantidad: 3 }),
    ]);

    const reporte = await ReporteService.obtenerReporteProductos(USUARIO, 1, 10, PERIODO);

    expect(reporte.data[0]).toMatchObject({
      vendidos: 2, devoluciones: 1, cancelados: 3, total_procesados: 6, venta_total: 300000,
    });
  });

  it('ordena por ingresos descendente', async () => {
    EnvioItem.findAll.mockResolvedValue([
      itemEntregado({ producto_id: 1, nombre_producto: 'Flojo', subtotal: 50000, componentes_vendidos: [{ cantidad: 2, costo_unitario: 10000 }] }),
      itemEntregado({ producto_id: 2, nombre_producto: 'Estrella', subtotal: 900000 }),
    ]);

    const reporte = await ReporteService.obtenerReporteProductos(USUARIO, 1, 10, PERIODO);

    expect(reporte.data.map((p) => p.nombre)).toEqual(['Estrella', 'Flojo']);
    expect(reporte.kpis.producto_estrella).toBe('Estrella');
  });

  it('filtra por nombre de producto en memoria', async () => {
    // El buscador por nombre no puede ir al WHERE del envío: el nombre
    // vive en el item, no en el pedido.
    EnvioItem.findAll.mockResolvedValue([
      itemEntregado({ producto_id: 1, nombre_producto: 'Creatina' }),
      itemEntregado({ producto_id: 2, nombre_producto: 'Proteína' }),
    ]);

    const reporte = await ReporteService.obtenerReporteProductos(USUARIO, 1, 10, { ...PERIODO, buscador: 'creat' });

    expect(reporte.data).toHaveLength(1);
    expect(reporte.data[0].nombre).toBe('Creatina');
  });

  it('pagina sobre el resultado agregado', async () => {
    EnvioItem.findAll.mockResolvedValue([
      itemEntregado({ producto_id: 1, nombre_producto: 'A', subtotal: 900000 }),
      itemEntregado({ producto_id: 2, nombre_producto: 'B', subtotal: 600000 }),
      itemEntregado({ producto_id: 3, nombre_producto: 'C', subtotal: 300000 }),
    ]);

    const reporte = await ReporteService.obtenerReporteProductos(USUARIO, 2, 2, PERIODO);

    expect(reporte.total).toBe(3);
    expect(reporte.paginas).toBe(2);
    expect(reporte.actual).toBe(2);
    expect(reporte.data.map((p) => p.nombre)).toEqual(['C']);
  });
});

describe('obtenerReporteConfirmadores', () => {
  it('agrupa por confirmador y calcula la tasa de cierre', async () => {
    Envio.findAll.mockResolvedValue([
      { confirmador: 'Test Agent', estado: 'Entregado', monto: 300000 },
      { confirmador: 'Test Agent', estado: 'Rechazado', monto: 100000 },
      { confirmador: null, estado: 'Entregado', monto: 50000 },
    ]);

    const reporte = await ReporteService.obtenerReporteConfirmadores(USUARIO, 1, 10, PERIODO);

    const agente = reporte.data.find((c) => c.nombre === 'Test Agent');
    expect(agente).toMatchObject({ procesados: 2, entregados: 1, rechazados: 1, ingresos: 300000 });

    // Un envío sin confirmador no se pierde: cae en "Sin Asignar".
    expect(reporte.data.find((c) => c.nombre === 'Sin Asignar')).toMatchObject({ entregados: 1, ingresos: 50000 });

    expect(reporte.kpis.top_confirmador).toBe('Test Agent');
    expect(reporte.kpis.total_ingresos).toBe(350000);
    // Promedio de tasas: 50% del agente y 100% de "Sin Asignar".
    expect(reporte.kpis.tasa_cierre_promedio).toBe(75);
  });

  it('sin datos no inventa un top ni divide por cero', async () => {
    Envio.findAll.mockResolvedValue([]);

    const reporte = await ReporteService.obtenerReporteConfirmadores(USUARIO, 1, 10, PERIODO);

    expect(reporte.total).toBe(0);
    expect(reporte.kpis.top_confirmador).toBe('Ninguno');
    expect(reporte.kpis.tasa_cierre_promedio).toBe(0);
  });
});

describe('obtenerReporteComisiones', () => {
  it('calcula la comisión y el neto de cada pedido', async () => {
    const pedidos = [
      { id: 5, monto: 300000, comision_pct_aplicada: 5, estado: 'Entregado' },
      { id: 6, monto: 100000, comision_pct_aplicada: null, estado: 'Entregado' },
    ];
    Envio.findAndCountAll.mockResolvedValue({ count: 2, rows: pedidos.map(instancia) });
    Envio.findAll.mockResolvedValue(pedidos);

    const reporte = await ReporteService.obtenerReporteComisiones(USUARIO, 1, 10, PERIODO);

    expect(reporte.data[0]).toMatchObject({ id: 5, costo_comision: 15000, precio_neto: 285000 });
    // Sin porcentaje aplicado la comisión es cero, no NaN.
    expect(reporte.data[1]).toMatchObject({ id: 6, costo_comision: 0, precio_neto: 100000 });

    expect(reporte.kpis).toMatchObject({
      total_facturado: 400000, total_comisiones: 15000, total_neto: 385000,
    });
  });
});

describe('obtenerReporteFacturacion', () => {
  it('calcula el IVA del 10% por pedido y en total', async () => {
    const pedidos = [
      { id: 5, monto: 300000, ruc: '80012345-6', razon_social: 'ACME', estado: 'Entregado' },
      { id: 6, monto: 55555, ruc: null, razon_social: null, estado: 'Entregado' },
    ];
    Envio.findAndCountAll.mockResolvedValue({ count: 2, rows: pedidos.map(instancia) });
    Envio.findAll.mockResolvedValue(pedidos);

    const reporte = await ReporteService.obtenerReporteFacturacion(USUARIO, 1, 10, PERIODO);

    expect(reporte.data[0]).toMatchObject({ id: 5, iva: 30000 });
    // Guaraníes no tienen decimales: el IVA se redondea.
    expect(reporte.data[1].iva).toBe(5556);

    expect(reporte.kpis).toMatchObject({ total_sujeto_iva: 355555, total_iva: 35556 });
  });
});
