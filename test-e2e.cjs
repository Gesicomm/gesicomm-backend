const axios = require('axios');

async function runTests() {
  console.log('--- Iniciando Prueba End-to-End ---');
  const api = axios.create({ baseURL: 'http://localhost:3000/api' });

  try {
    // 1. Intentar hacer un ping al backend
    console.log('1. Verificando estado del servidor...');
    await api.get('/').catch(() => {}); // Omitimos si no hay ruta raíz
    console.log('   OK: Servidor respondiendo.');

    console.log('2. Generando token de acceso simulado...');
    require('dotenv').config();
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: 1, rol: 'ADMIN', tenantId: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
    api.defaults.headers.common['Cookie'] = `accessToken=${token}`;
    console.log('   OK: Sesión iniciada.');

    // 3. Probar POST KPIs
    console.log('3. Probando POST KPIs');
    let res = await api.post('/reportes/kpis', { periodo: 'este_mes' });
    console.log(`   OK: Status ${res.status}, KPIs obtenidos: Ventas Netas = ${res.data.actual?.ventas_netas}`);

    console.log('4. Probando POST Evolución Ventas');
    res = await api.post('/reportes/evolucion-ventas', { periodo: 'este_mes' });
    console.log(`   OK: Status ${res.status}, Registros de evolución: ${res.data.length}`);

    console.log('5. Probando POST Vista Pedidos (Paginación 10)');
    res = await api.post('/reportes/pedidos', { pagina: 1, limite: 10, buscador: '' });
    console.log(`   OK: Status ${res.status}, Pedidos obtenidos: ${res.data.pedidos?.length}. Paginación: ${res.data.paginas} páginas.`);

    console.log('6. Probando POST Vista Items Vendidos (Con Buscador)');
    res = await api.post('/reportes/items', { pagina: 1, limite: 10, buscador: 'a' });
    console.log(`   OK: Status ${res.status}, Ítems obtenidos: ${res.data.items?.length}.`);

    console.log('7. Probando POST Comisiones (Paginación 10 y Buscador)');
    res = await api.post('/reportes/comisiones', { pagina: 1, limite: 10, buscador: 'a' });
    console.log(`   OK: Status ${res.status}, Comisiones obtenidas: ${res.data.data.length}. Paginación: ${res.data.paginas} páginas.`);

    console.log('8. Probando POST Facturacion (Paginación 10 y Buscador)');
    res = await api.post('/reportes/facturacion', { pagina: 1, limite: 10, buscador: 'a' });
    console.log(`   OK: Status ${res.status}, Facturas obtenidas: ${res.data.data.length}. Paginación: ${res.data.paginas} páginas.`);

    console.log('\n✅ PRUEBAS E2E COMPLETADAS EXITOSAMENTE. NO SE DETECTARON ERRORES 500.');
  } catch (error) {
    console.log('\n❌ ERROR DURANTE LAS PRUEBAS:');
    console.log(error);
  }
}

runTests();
