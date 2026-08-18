'use strict';

/**
 * Migración única: crea las 3 tablas nuevas del módulo de Reportes de
 * Meta Ads (campañas internas + importaciones de CSV + filas de reporte).
 *
 * A diferencia de migrate-tienda.js, esto NO toca ninguna tabla existente
 * — no hay addColumn/removeColumn/changeColumn sobre nada que ya tenga
 * datos. Son 3 tablas 100% nuevas, así que alcanza con Model.sync() por
 * modelo (mismo patrón ya usado acá para Tienda: "sync individual, no
 * toca ninguna otra tabla"), en el orden correcto para que las FKs
 * encuentren la tabla referenciada ya creada:
 *
 *   1. meta_campanas_internas  (FK -> meta_integrations, landings, usuarios)
 *   2. meta_reporte_imports    (sin FKs a las tablas nuevas)
 *   3. meta_reporte_filas      (FK -> meta_reporte_imports, meta_campanas_internas)
 *
 * No usa sequelize.sync({alter:true}) global ni toca nada fuera de estas
 * 3 tablas. Es un script de una sola vez — no se corre en cada boot.
 *
 * Ejecutar con:
 *   node scripts/migrate-meta-reportes.js
 */

require('dotenv').config();
const { sequelize, MetaCampanaInterna, MetaReporteImport, MetaReporteFila } = require('../src/models');

async function migrar() {
  try {
    await sequelize.authenticate();

    console.log('Creando meta_campanas_internas...');
    await MetaCampanaInterna.sync();

    console.log('Creando meta_reporte_imports...');
    await MetaReporteImport.sync();

    console.log('Creando meta_reporte_filas...');
    await MetaReporteFila.sync();

    console.log('\nMigración completada. 3 tabla(s) nueva(s) verificada(s)/creada(s).');
  } catch (err) {
    console.error('Error durante la migración:', err.message);
    throw err;
  }
}

migrar()
  .then(() => { process.exit(0); })
  .catch(() => { process.exit(1); });
