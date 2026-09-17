const { Usuario } = require('./src/models');
const ReporteService = require('./src/services/reporteService');

async function run() {
  try {
    const usuario = await Usuario.findOne();
    if (!usuario) {
      console.error('No se encontro usuario de prueba.');
      process.exit(1);
    }

    const filtros = {};
    const kpiGlobal = await ReporteService.obtenerKPIs(usuario.id, filtros);
    const repFondo = await ReporteService.obtenerReporteProductos(usuario.id, 1, 500, filtros);
    const repComposicion = await ReporteService.obtenerReporteComposicion(usuario.id, 1, 500, filtros);
    
    // Novedades de la Fase 3
    const repClientes = await ReporteService.obtenerReporteClientes(usuario.id, 1, 500, filtros);
    const repMetodos = await ReporteService.obtenerReporteMetodosPago(usuario.id, 1, 500, filtros);
    const repFallos = await ReporteService.obtenerReporteFallos(usuario.id, 1, 500, filtros);

    const vKPI = kpiGlobal.actual.ventas_netas;
    const vProd = repFondo.kpis.ventas_netas;
    const vComp = repComposicion.kpis.ventas_netas;

    console.log('--- FASE 2: PRODUCTOS Y COMPOSICION ---');
    console.log('KPI Global Ventas Netas: ', vKPI);
    console.log('Reporte Productos Ventas Netas: ', vProd);
    console.log('Reporte Composicion Ventas Netas: ', vComp);

    if (vKPI !== vProd || vKPI !== vComp) {
      console.error('❌ DISCREPANCIA EN LOS CÁLCULOS DE FASE 2!');
      process.exit(1);
    }

    console.log('\n--- FASE 3: CLIENTES, PAGOS Y FALLOS ---');

    // 1. Clientes
    const { clientes_con_pedido, clientes_compradores, clientes_recurrentes } = repClientes.kpis;
    console.log('Clientes con pedido:', clientes_con_pedido);
    console.log('Clientes compradores:', clientes_compradores);
    console.log('Clientes recurrentes:', clientes_recurrentes);
    
    if (clientes_compradores > clientes_con_pedido) {
      console.error('❌ INVARIANTE ROTA: clientes_compradores > clientes_con_pedido');
      process.exit(1);
    }
    if (clientes_recurrentes > clientes_compradores) {
      console.error('❌ INVARIANTE ROTA: clientes_recurrentes > clientes_compradores');
      process.exit(1);
    }

    // 2. Metodos de Pago
    const { total_pedidos, total_exitosos, total_fallidos, total_abiertos, total_ventas_netas, pedidos_cerrados } = repMetodos.kpis;
    console.log('Total pedidos metodo pago:', total_pedidos);
    console.log('Pedidos exitosos metodo pago:', total_exitosos);
    console.log('Pedidos fallidos metodo pago:', total_fallidos);
    console.log('Pedidos cerrados metodo pago:', pedidos_cerrados);
    console.log('Pedidos abiertos metodo pago:', total_abiertos);
    console.log('Ventas netas globales por metodo:', total_ventas_netas);

    if (pedidos_cerrados !== total_exitosos + total_fallidos) {
      console.error('❌ INVARIANTE ROTA: pedidos_cerrados !== exitosos + fallidos');
      process.exit(1);
    }
    
    if (total_pedidos !== total_exitosos + total_fallidos + total_abiertos) {
      console.error('❌ INVARIANTE ROTA: pedidos_exitosos + fallidos + abiertos !== total_pedidos');
      process.exit(1);
    }

    if (total_ventas_netas !== vKPI) {
      console.error('❌ INVARIANTE ROTA: SUM(ventas_netas_por_metodo) !== ventas_netas_globales');
      process.exit(1);
    }
    
    // Tasa exito + Tasa fallo = 100%
    const sumTasas = repMetodos.data.reduce((acc, row) => {
      // Suma de la participacion debe ser 100
      return acc + row.participacion;
    }, 0);
    
    // Check if sum of participacion is ~100 or 0
    if (sumTasas > 0 && Math.abs(sumTasas - 100) > 0.1) {
      console.error('❌ INVARIANTE ROTA: sum(participacion ventas) !== 100%', sumTasas);
      process.exit(1);
    }

    // ============================================================
    // FASE 4: GEOGRAFÍA, LOGÍSTICA Y CROSS-SELLING
    // ============================================================
    const repGeo = await ReporteService.obtenerReporteGeografia(usuario.id, 1, 500, filtros);
    const repLog = await ReporteService.obtenerReporteLogistica(usuario.id, 1, 500, filtros);
    const repCross = await ReporteService.obtenerReporteCrossSelling(usuario.id, 1, 500, filtros);

    console.log('\n--- FASE 4: GEOGRAFÍA, LOGÍSTICA Y CROSS-SELLING ---');

    // ---- Geografía ----
    const sumaVentasGeo = repGeo.data.reduce((acc, g) => acc + g.ventas_netas, 0);
    console.log('Ventas netas geográficas:', sumaVentasGeo, '=== KPI global:', repGeo.kpis.ventas_netas_globales);
    if (sumaVentasGeo !== repGeo.kpis.ventas_netas_globales) {
      console.error('❌ INVARIANTE ROTA: SUM(ventas_geo) !== ventas_netas_globales');
      process.exit(1);
    }
    if (sumaVentasGeo !== vKPI) {
      console.error('❌ INVARIANTE ROTA: SUM(ventas_geo) !== KPI global de ventas');
      process.exit(1);
    }
    // Tasa de fallo solo sobre cerrados (no null para sin_datos)
    const geoConTasa = repGeo.data.filter(g => g.tasa_fallo !== null);
    const geoConFalloInvalido = geoConTasa.filter(g => g.tasa_fallo < 0 || g.tasa_fallo > 100);
    if (geoConFalloInvalido.length > 0) {
      console.error('❌ INVARIANTE ROTA: tasa_fallo fuera de rango [0,100]');
      process.exit(1);
    }

    // ---- Logística ----
    const sumaEntregados = repLog.data.reduce((acc, c) => acc + c.pedidos_entregados, 0);
    console.log('Pedidos entregados por courier:', sumaEntregados, '=== KPI:', repLog.kpis.total_entregados);
    if (sumaEntregados !== repLog.kpis.total_entregados) {
      console.error('❌ INVARIANTE ROTA: SUM(entregados_por_courier) !== total_entregados');
      process.exit(1);
    }
    // Tasa de entrega válida: null o [0,100]
    const logConTasaInvalida = repLog.data.filter(c => c.tasa_entrega !== null && (c.tasa_entrega < 0 || c.tasa_entrega > 100));
    if (logConTasaInvalida.length > 0) {
      console.error('❌ INVARIANTE ROTA: tasa_entrega fuera de rango [0,100]');
      process.exit(1);
    }
    // pedidos_logisticos_cerrados = entregados + devueltos
    const logCerradosInvalidos = repLog.data.filter(c => c.pedidos_logisticos_cerrados !== c.pedidos_entregados + c.pedidos_devueltos);
    if (logCerradosInvalidos.length > 0) {
      console.error('❌ INVARIANTE ROTA: pedidos_logisticos_cerrados !== entregados + devueltos');
      process.exit(1);
    }

    // ---- Cross-Selling ----
    console.log('Pares de afinidad detectados:', repCross.kpis.pares_detectados);
    console.log('Pedidos exitosos analizados:', repCross.kpis.pedidos_exitosos_analizados);
    // pedidos_juntos <= min(pedidos_A, pedidos_B)
    const crossViolations = repCross.data.filter(p => p.pedidos_juntos > Math.min(p.pedidos_producto_a, p.pedidos_producto_b));
    if (crossViolations.length > 0) {
      console.error('❌ INVARIANTE ROTA: pedidos_juntos > min(pedidos_A, pedidos_B)');
      process.exit(1);
    }
    // Tasas en rango [0,100]
    const crossTasasInvalidas = repCross.data.filter(p => p.tasa_a_con_b > 100 || p.tasa_b_con_a > 100 || p.tasa_a_con_b < 0 || p.tasa_b_con_a < 0);
    if (crossTasasInvalidas.length > 0) {
      console.error('❌ INVARIANTE ROTA: tasas de combinación fuera de rango [0,100]');
      process.exit(1);
    }

    console.log('\n✅ SIN DISCREPANCIAS. Todas las invariantes lógicas y sumatorias coinciden.');
    process.exit(0);

  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
