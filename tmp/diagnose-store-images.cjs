require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const c = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionTimeoutMillis: 8000 });
(async () => {
  await c.connect();
  const stores = (await c.query("SELECT t.id,t.nombre,t.subdominio,t.dominio_propio,t.usuario_id FROM tiendas t JOIN usuarios u ON u.id=t.usuario_id WHERE lower(u.correo_electronico)=$1", ['andre@gmail.com'])).rows;
  console.log(JSON.stringify(stores));
  for (const t of stores) {
    const landings = (await c.query('SELECT id,titulo,slug,activo,es_home,content FROM landings WHERE tienda_id=$1', [t.id])).rows;
    require('fs').writeFileSync(`tmp/store-${t.id}-landings-backup.json`, JSON.stringify(landings, null, 2));
    console.log(JSON.stringify(landings.map(l => ({ ...l, content: undefined, contentKeys: Object.keys(l.content || {}) }))));
  }
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
