'use strict';
process.env.NODE_ENV='test';
const db=require('../src/config/database');
db.options.logging=false;
const nombre='20261025180000-categorias-por-tienda.js';
const aplicar=process.argv.includes('--aplicar');
const rollback=Symbol('verificacion');
(async()=>{
  try {
    await db.transaction(async transaction=>{
      await db.query("SELECT pg_advisory_xact_lock(25180000)",{transaction});
      await db.query('CREATE TABLE IF NOT EXISTS "SequelizeMeta" (name VARCHAR(255) PRIMARY KEY)',{transaction});
      const [hecha]=await db.query('SELECT name FROM "SequelizeMeta" WHERE name=:nombre',{replacements:{nombre},transaction});
      if (!hecha.length) {
        await require('../migrations/'+nombre).up(db.getQueryInterface(),transaction);
        await db.query('INSERT INTO "SequelizeMeta"(name) VALUES(:nombre)',{replacements:{nombre},transaction});
      }
      const [verificacion]=await db.query(`SELECT c.id,c.nombre,c.tienda_id,t.nombre tienda,
        (SELECT count(*) FROM productos p WHERE p.categoria_id=c.id) productos
        FROM categorias c LEFT JOIN tiendas t ON t.id=c.tienda_id WHERE c.nombre ILIKE '%concep%'`,{transaction});
      const [inconsistencias]=await db.query(`SELECT count(*) n FROM categoria_asignaciones_tienda a
        JOIN categorias c ON c.id=a.categoria_id WHERE c.tienda_id IS DISTINCT FROM a.tienda_id`,{transaction});
      if (Number(inconsistencias[0].n)) throw new Error('Asignaciones fuera de tienda');
      console.log(JSON.stringify({modo:aplicar?'aplicar':'ensayo con rollback',yaAplicada:!!hecha.length,verificacion,inconsistencias:0}));
      if (!aplicar) throw rollback;
    });
    console.log('Migración confirmada y registrada.');
  } catch(e) {
    if(e===rollback) console.log('Ensayo revertido; no se persistieron cambios.');
    else {console.error(e.message);process.exitCode=1;}
  } finally {await db.close();}
})();
