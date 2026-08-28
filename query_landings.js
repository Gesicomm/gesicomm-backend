const { Landing, Tienda, Usuario } = require('./src/models');

async function run() {
  const landings = await Landing.findAll({
    order: [['id', 'DESC']],
    limit: 5,
    include: [{
      model: Tienda,
      include: [{ model: Usuario, attributes: ['activo'] }]
    }]
  });
  
  for (const l of landings) {
    console.log(`ID: ${l.id}, Slug: ${l.slug}, TiendaID: ${l.tienda_id}, Activo: ${l.activo}, EsHome: ${l.es_home}, Tipo: ${l.tipo_pagina}`);
    if (l.Tienda) {
      console.log(`  -> Tienda Activo: ${l.Tienda.activo}, Subdominio: ${l.Tienda.subdominio}`);
      if (l.Tienda.Usuario) {
        console.log(`  -> Usuario Activo: ${l.Tienda.Usuario.activo}`);
      }
    }
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
