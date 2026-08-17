const { ReporteService } = require('./src/services/reporteService');
const { Usuario } = require('./src/models');

(async () => {
  try {
    // We assume user 1 is the main user for testing
    const ReporteClass = require('./src/services/reporteService');
    const result = await ReporteClass.obtenerReporteComisiones(1, 1, 10, { periodo: 'este_mes' });
    console.log("Comisiones:", JSON.stringify(result, null, 2));

    const facturacion = await ReporteClass.obtenerReporteFacturacion(1, 1, 10, { periodo: 'este_mes' });
    console.log("Facturacion:", JSON.stringify(facturacion, null, 2));

    const productos = await ReporteClass.obtenerReporteProductos(1, 1, 10, { periodo: 'este_mes' });
    console.log("Productos:", JSON.stringify(productos, null, 2));

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
})();
