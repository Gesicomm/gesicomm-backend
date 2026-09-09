/**
 * Diagnóstico de un dominio propio: qué dice la base y qué dice el DNS.
 *
 *   node check_tienda.js mitienda.com
 *
 * Reemplaza a la versión que consultaba el estado en Cloudflare: los
 * dominios propios ya no pasan por ningún proveedor, se verifican
 * resolviendo su registro A contra ORIGIN_IP (src/utils/dominios.js).
 */

const { Tienda } = require('./src/models');
const { registrosPara, apuntaANuestroServidor, sirvePorHttps } = require('./src/utils/dominios');

async function run() {
  const dominio = process.argv[2];
  if (!dominio) {
    console.log('Uso: node check_tienda.js <dominio>');
    process.exit(1);
  }

  const tienda = await Tienda.findOne({ where: { dominio_propio: dominio } });
  if (!tienda) {
    console.log(`Ninguna tienda tiene cargado el dominio ${dominio}.`);
    process.exit(0);
  }

  console.log('En la base:');
  console.log('- Tienda ID:', tienda.id);
  console.log('- Dominio propio:', tienda.dominio_propio);
  console.log('- Verificado:', tienda.dominio_propio_verificado);

  console.log('\nRegistros que le pedimos al cliente:');
  console.table(registrosPara(dominio));

  const { apunta, ips, detalle } = await apuntaANuestroServidor(dominio);
  console.log('\nEn el DNS:');
  console.log('- Resuelve a:', ips.length ? ips.join(', ') : '(nada)');
  console.log('- Apunta acá:', apunta, detalle ? `— ${detalle}` : '');

  if (apunta) {
    console.log('- Sirve por HTTPS:', await sirvePorHttps(dominio));
  }

  process.exit(0);
}

run();
