const { ProveedorDns } = require('./src/models');
const sequelize = require('./src/config/database');

async function run() {
  await sequelize.authenticate();
  await ProveedorDns.sync({ alter: true });
  
  const proveedores = [
    {
      nombre: 'GoDaddy',
      whois_match: 'godaddy',
      url_login: 'https://dcc.godaddy.com/manage/{dominio}/dns',
      instrucciones: '1. Inicia sesión en GoDaddy.\n2. Ve a la sección DNS.\n3. Agrega un registro TXT con los valores proporcionados abajo.',
    },
    {
      nombre: 'Namecheap',
      whois_match: 'namecheap',
      url_login: 'https://ap.namecheap.com/domains/domaincontrolpanel/{dominio}/advancedns',
      instrucciones: '1. Inicia sesión en Namecheap.\n2. Ve a "Advanced DNS".\n3. Agrega un nuevo registro TXT.',
    },
    {
      nombre: 'Hostinger',
      whois_match: 'hostinger',
      url_login: 'https://hpanel.hostinger.com/manage-domain/{dominio}/dns',
      instrucciones: '1. Inicia sesión en hPanel.\n2. Selecciona tu dominio y ve a DNS / Nameservers.\n3. Agrega el registro TXT.',
    },
    {
      nombre: 'Cloudflare',
      whois_match: 'cloudflare',
      url_login: 'https://dash.cloudflare.com/',
      instrucciones: '1. Inicia sesión en Cloudflare.\n2. Selecciona tu dominio y ve a DNS -> Records.\n3. Añade el registro TXT y asegúrate de marcar la nube como "DNS Only" (Gris).',
    }
  ];

  for (const p of proveedores) {
    const existe = await ProveedorDns.findOne({ where: { whois_match: p.whois_match } });
    if (!existe) {
      await ProveedorDns.create(p);
    }
  }
  console.log('Seed completo');
  process.exit(0);
}

run();
