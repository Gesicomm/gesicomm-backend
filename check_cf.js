const { Tienda } = require('./src/models');

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

function config() {
  const zoneId = process.env.CF_ZONE_ID;
  const apiToken = process.env.CF_API_TOKEN;
  if (!zoneId || !apiToken) {
    throw new Error('Cloudflare no está configurado');
  }
  return { zoneId, apiToken };
}

async function llamarCF(path, options = {}) {
  const { apiToken } = config();
  const res = await fetch(`${CF_API_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    const mensaje = data.errors?.map(e => e.message).join('; ') || `Error de Cloudflare (HTTP ${res.status}).`;
    throw new Error(mensaje);
  }
  return data.result;
}

async function run() {
  const { zoneId } = config();
  
  const tiendas = await Tienda.findAll({ where: { dominio_propio: 'gesis.cogymtraining.com' } });
  const t = tiendas[0];
  
  const result = await llamarCF(`/zones/${zoneId}/custom_hostnames/${t.dominio_propio_cf_hostname_id}`, {
    method: 'GET',
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
run();
