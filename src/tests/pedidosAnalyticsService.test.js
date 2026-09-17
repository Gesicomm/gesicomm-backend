const PedidosAnalyticsService = require('../services/pedidosAnalyticsService');

describe('PedidosAnalyticsService - Lógica de Estados', () => {
  it('Debe contar como "Despachado" si el estado es En tránsito, Entregado, Reprogramado o Devuelto', () => {
    const enviosSimulados = [
      { estado: 'Pendiente' }, // NO despachado
      { estado: 'Confirmado' }, // NO despachado
      { estado: 'Empacado' }, // NO despachado
      { estado: 'En tránsito' }, // Despachado
      { estado: 'Entregado' }, // Despachado
      { estado: 'Reprogramado' }, // Despachado
      { estado: 'Devuelto' }, // Despachado
      { estado: 'Pendiente', estado_logistico: 'asignado' } // Despachado logísticamente
    ];

    // Mock de catálogo básico para que el script no falle
    const catalogoCanales = [{ id: 1, slug: 'web', nombre: 'Web' }];

    const resultado = PedidosAnalyticsService.procesar(enviosSimulados, catalogoCanales, { desde: null, hasta: null });
    
    // De los 8 envíos, 5 cumplen la condición de despachado según nuestra lógica nueva.
    expect(resultado.embudo.despachados).toBe(5);
  });

  it('No debe considerar despachado a un pedido solo por tener courier_id si su estado no es de tránsito', () => {
    const enviosSimulados = [
      { estado: 'Pendiente', courier_id: 10 }, // Tiene courier pero no salió (No despachado)
      { estado: 'Confirmado', courier_id: 10 } // (No despachado)
    ];

    const catalogoCanales = [{ id: 1, slug: 'web', nombre: 'Web' }];
    const resultado = PedidosAnalyticsService.procesar(enviosSimulados, catalogoCanales, { desde: null, hasta: null });
    
    expect(resultado.embudo.despachados).toBe(0);
  });

  it('Debe contar correctamente los pedidos Reprogramados', () => {
    const enviosSimulados = [
      { estado: 'Reprogramado' },
      { estado: 'Pendiente', estado_logistico: 'reprogramado' }
    ];

    const catalogoCanales = [{ id: 1, slug: 'web', nombre: 'Web' }];
    const resultado = PedidosAnalyticsService.procesar(enviosSimulados, catalogoCanales, { desde: null, hasta: null });
    
    expect(resultado.embudo.reprogramados).toBe(2);
  });
});
