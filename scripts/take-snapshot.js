require('dotenv').config();
const { getAnalyticsCompleto } = require('../src/services/pedidosAnalyticsService');
const { Usuario, sequelize } = require('../src/models');
const fs = require('fs');
const path = require('path');

async function run() {
  try {
    const user = await Usuario.findOne({ order: [['id', 'ASC']] });
    if (!user) {
      console.log('No user found in DB. Snapshot empty.');
      process.exit(0);
    }
    
    console.log(`Running snapshot for user ${user.id}...`);
    
    const data = await getAnalyticsCompleto({ periodo: 'este_mes' }, user.id);
    
    // Save to baseline.json
    const outputPath = path.join(__dirname, '..', 'baseline_snapshot.json');
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`Baseline snapshot saved to ${outputPath}`);
    
    // Print the summary
    console.log('\n--- BASELINE SUMMARY ---');
    console.log(`PEDIDOS: ${data.funnel.total_creados}`);
    console.log(`CONFIRMADOS: ${data.funnel.confirmados}`);
    console.log(`DESPACHADOS: ${data.funnel.despachados}`);
    console.log(`ENTREGADOS: ${data.funnel.entregados}`);
    console.log(`DEVUELTOS: ${data.funnel.devueltos}`);
    console.log(`FACTURACION: ${data.kpis.facturacion_entregada}`);
    console.log(`MARGEN: ${data.kpis.margen_bruto_estimado}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error generating snapshot:', error);
    process.exit(1);
  }
}

run();
