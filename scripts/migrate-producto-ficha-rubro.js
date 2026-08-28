'use strict';

/**
 * Runner de migrations/add_producto_ficha_rubro.sql — agrega a `productos`
 * el rubro de ficha y sus datos propios de ese rubro (ver el .sql para el
 * motivo y la forma de cada rubro).
 *
 * Aditiva e idempotente: solo ADD COLUMN IF NOT EXISTS. No reescribe ni
 * borra ninguna fila, y correrlo dos veces no hace nada la segunda vez.
 *
 *   node scripts/migrate-producto-ficha-rubro.js
 *
 * IMPORTANTE: el modelo Producto ya declara estas dos columnas, así que
 * hasta que esto corra las consultas de productos fallan. Es lo normal en
 * una migración: primero el esquema, después la app.
 */

const fs = require('fs');
const path = require('path');
const sequelize = require('../src/config/database');

const ARCHIVO_SQL = path.join(__dirname, '..', 'migrations', 'add_producto_ficha_rubro.sql');

async function migrar() {
  try {
    await sequelize.query(fs.readFileSync(ARCHIVO_SQL, 'utf8'));

    const columnas = await sequelize.query(
      `select column_name, data_type, column_default
         from information_schema.columns
        where table_name = 'productos'
          and column_name in ('ficha_rubro', 'ficha_datos')
        order by column_name`,
      { type: sequelize.QueryTypes.SELECT }
    );

    if (columnas.length !== 2) {
      throw new Error(`Se esperaban 2 columnas y quedaron ${columnas.length}.`);
    }

    console.log('Migración OK. Columnas agregadas a productos:');
    columnas.forEach(c => console.log(`  - ${c.column_name} (${c.data_type}) default ${c.column_default || 'NULL'}`));
  } catch (error) {
    console.error('Error en la migración:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

migrar();
