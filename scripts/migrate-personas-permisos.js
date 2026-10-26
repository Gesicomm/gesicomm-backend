'use strict';
// Ejecuta solo la migración de esta funcionalidad, sin aplicar pendientes ajenos.
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
const db = require('../src/config/database');
const nombre = '20261025160000-personas-permisos.js';
(async () => {
  try {
    await db.authenticate();
    await require('../migrations/' + nombre).up(db.getQueryInterface());
    await db.query('CREATE TABLE IF NOT EXISTS "SequelizeMeta" (name VARCHAR(255) PRIMARY KEY)');
    await db.query('INSERT INTO "SequelizeMeta" (name) VALUES (:nombre) ON CONFLICT (name) DO NOTHING', { replacements: { nombre } });
    const [rows] = await db.query("SELECT current_database() AS base, (SELECT count(*) FROM tienda_miembros) AS miembros, (SELECT count(*) FROM roles WHERE nombre = 'colaborador') AS roles_colaborador");
    console.log(JSON.stringify({ migration: nombre, status: 'aplicada', verificacion: rows[0] }));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { await db.close(); }
})();
