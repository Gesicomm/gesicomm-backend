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

    console.log('\n✅ SIN DISCREPANCIAS. Todas las invariantes lógicas y sumatorias coinciden.');
    process.exit(0);

  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
