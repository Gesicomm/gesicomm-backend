const { Tienda } = require('./src/models');
const CloudflareService = require('./src/services/cloudflare.service');

async function run() {
  const tiendas = await Tienda.findAll({ where: { dominio_propio: 'gesis.cogymtraining.com' } });
  if (tiendas.length === 0) {
    console.log('No tienda found');
    process.exit(0);
  }
  const t = tiendas[0];
  console.log('Tienda DB Status:');
  console.log('- ID:', t.id);
  console.log('- Dominio Propio:', t.dominio_propio);
  console.log('- Verificado en DB?:', t.dominio_propio_verificado);
  
  if (t.dominio_propio_cf_hostname_id) {
    console.log('\nConsultando a Cloudflare...');
    try {
      const status = await CloudflareService.verificarEstado(t.dominio_propio_cf_hostname_id);
      console.log('Cloudflare Status:', JSON.stringify(status, null, 2));
    } catch (e) {
      console.log('Error CF:', e.message);
    }
  }
  process.exit(0);
}
run();
