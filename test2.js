const ReporteClass = require('./src/services/reporteService');

(async () => {
  try {
    const filtros = {
      periodo: 'este_mes',
      mes: 8,
      anio: 2026,
      confirmador: 'TODOS',
      courierId: 'TODOS',
      origen: 'TODOS'
    };
    const result = await ReporteClass.obtenerReporteConfirmadores(1, 1, 50, filtros);
    console.log("Confirmadores:", JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
})();
