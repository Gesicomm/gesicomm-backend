const { Inquilino, Usuario, Producto, Envio, EnvioItem, EnvioItemComponente } = require('../models');
const ReporteService = require('../services/reporteService');

jest.setTimeout(30000);

describe('ReporteService Integration Tests', () => {
  let testInquilinoId;
  let testUsuarioId;
  let testProductoId;
  let testEnvioId;
  let testEnvioItemId;

  beforeAll(async () => {
    // 1. Inquilino
    const inq = await Inquilino.create({
      nombre: 'TEST_JEST_REPORT_INQ',
      subdominio: 'test-report-' + Date.now(),
      activo: true,
    });
    testInquilinoId = inq.id;

    // 2. Usuario
    const user = await Usuario.create({
      inquilino_id: testInquilinoId,
      nombre: 'Report Test User',
      correo_electronico: 'report-' + Date.now() + '@jest.com',
      contrasena_hash: '123',
    });
    testUsuarioId = user.id;

    // 3. Producto
    const prod = await Producto.create({
      inquilino_id: testInquilinoId,
      nombre: 'Test Report Product',
      slug: 'test-report-product-' + Date.now(),
      tipo_producto: 'fisico',
      precio: 150000,
      precio_costo: 50000,
      stock: 50,
    });
    testProductoId = prod.id;

    // 4. Envio (Pedido)
    const envio = await Envio.create({
      usuario_id: testUsuarioId,
      monto: 300000,
      costo_envio: 15000,
      metodo_pago: 'Transferencia',
      estado: 'Entregado',
      fecha: '2026-08-25',
      hora: '14:00',
      confirmador: 'Test Agent',
      cliente: 'John Doe',
      nombre_cliente: 'John',
      apellido_cliente: 'Doe',
      telefono: '0981111222',
      ciudad: 'Asunción',
      direccion: 'Avda Mcal Lopez 123',
      origen: 'WEB',
    });
    testEnvioId = envio.id;

    // 5. EnvioItem
    const item = await EnvioItem.create({
      envio_id: testEnvioId,
      producto_id: testProductoId,
      nombre_producto: 'Test Report Product',
      origen_venta: 'normal',
      request_origin: 'WEB',
      cantidad: 2,
      precio_unitario: 150000,
      precio_normal: 150000,
      subtotal: 300000,
    });
    testEnvioItemId = item.id;

    await EnvioItemComponente.create({
      envio_item_id: testEnvioItemId,
      producto_id: testProductoId,
      cantidad: 2,
      costo_unitario: 50000,
    });
  });

  afterAll(async () => {
    // Clean up in reverse dependency order
    await EnvioItemComponente.destroy({ where: { envio_item_id: testEnvioItemId } }).catch(() => null);
    await EnvioItem.destroy({ where: { envio_id: testEnvioId } }).catch(() => null);
    await Envio.destroy({ where: { id: testEnvioId } }).catch(() => null);
    await Producto.destroy({ where: { id: testProductoId } }).catch(() => null);
    await Usuario.destroy({ where: { id: testUsuarioId } }).catch(() => null);
    await Inquilino.destroy({ where: { id: testInquilinoId } }).catch(() => null);
  });

  test('should obtain KPIs successfully', async () => {
    const kpis = await ReporteService.obtenerKPIs(testUsuarioId, {
      fecha_desde: '2026-08-01',
      fecha_hasta: '2026-08-31',
    });

    expect(kpis).toBeDefined();
    expect(kpis.ventas_totales).toBe(300000);
    expect(kpis.pedidos).toBe(1);
    expect(kpis.ticket_promedio).toBe(300000);
  });

  test('should obtain Pedidos report successfully', async () => {
    const report = await ReporteService.obtenerPedidos(testUsuarioId, 1, 10, {
      fecha_desde: '2026-08-01',
      fecha_hasta: '2026-08-31',
    });

    expect(report).toBeDefined();
    expect(report.total).toBe(1);
    expect(report.pedidos.length).toBe(1);
    expect(report.pedidos[0].monto).toBe(300000);
    expect(report.pedidos[0].cliente).toBe('John Doe');
  });

  test('should obtain Items report successfully', async () => {
    const report = await ReporteService.obtenerItemsVendidos(testUsuarioId, 1, 10, {
      fecha_desde: '2026-08-01',
      fecha_hasta: '2026-08-31',
    });

    expect(report).toBeDefined();
    expect(report.total).toBe(1);
    expect(report.items.length).toBe(1);
    expect(report.items[0].nombre_producto).toBe('Test Report Product');
    expect(report.items[0].cantidad).toBe(2);
  });

  test('should obtain Comisiones report successfully', async () => {
    const report = await ReporteService.obtenerReporteComisiones(testUsuarioId, 1, 10, {
      fecha_desde: '2026-08-01',
      fecha_hasta: '2026-08-31',
    });

    expect(report).toBeDefined();
    expect(report.data).toBeDefined();
  });

  test('should obtain Facturacion report successfully', async () => {
    const report = await ReporteService.obtenerReporteFacturacion(testUsuarioId, 1, 10, {
      fecha_desde: '2026-08-01',
      fecha_hasta: '2026-08-31',
    });

    expect(report).toBeDefined();
    expect(report.data).toBeDefined();
  });

  test('should obtain Productos report successfully', async () => {
    const report = await ReporteService.obtenerReporteProductos(testUsuarioId, 1, 10, {
      fecha_desde: '2026-08-01',
      fecha_hasta: '2026-08-31',
    });

    expect(report).toBeDefined();
    expect(report.total).toBe(1);
    expect(report.data.length).toBe(1);
    expect(report.data[0].nombre).toBe('Test Report Product');
    expect(report.data[0].vendidos).toBe(2);
    expect(report.data[0].venta_total).toBe(300000);
    expect(report.data[0].costo_total).toBe(100000);
    expect(report.data[0].ingresos).toBe(200000);
    expect(report.data[0].precio_venta_unitario).toBe(150000);
    expect(report.data[0].precio_costo_unitario).toBe(50000);
    expect(report.kpis.total_ingresos).toBe(200000);
  });

  test('should obtain Confirmadores report successfully', async () => {
    const report = await ReporteService.obtenerReporteConfirmadores(testUsuarioId, 1, 10, {
      fecha_desde: '2026-08-01',
      fecha_hasta: '2026-08-31',
    });

    expect(report).toBeDefined();
    expect(report.total).toBe(1);
    expect(report.data.length).toBe(1);
    expect(report.data[0].nombre).toBe('Test Agent');
    expect(report.data[0].ingresos).toBe(300000);
  });
});
