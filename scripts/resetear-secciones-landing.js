'use strict';

/**
 * Script puntual — borra TODAS las secciones (landing_secciones) de la
 * landing id=10 ("Test landing - QA bug fix"), tanto page_type='landing'
 * como 'product'. Es la landing de prueba usada para depurar el armador
 * en esta sesión — acumuló duplicados de varias tandas de guardado antes
 * del fix de stable_id (ver normalizarSeccion en landing.service.js) con
 * `orden` distintos entre sí, así que scripts/limpiar-secciones-
 * duplicadas.js no los agrupa bien.
 *
 * Después de correr esto, la próxima vez que se abra el editor de esa
 * landing, se reconstruye sola desde los defaults (getSeccionesBase() /
 * el fallback de "Vista de Producto") — no hace falta recrear nada a mano.
 * No toca landing_id != 10 ni ninguna otra tabla (items, testimonios, faq,
 * la landing en sí siguen intactos).
 *
 * Ejecutar: node scripts/resetear-secciones-landing.js
 */

require('dotenv').config();
const { sequelize } = require('../src/models');

const LANDING_ID = 10;

async function resetear() {
  const [filas] = await sequelize.query(
    `SELECT id, page_type, tipo FROM landing_secciones WHERE landing_id = ${LANDING_ID} ORDER BY id`
  );
  console.log(`Se van a borrar ${filas.length} filas de landing_secciones (landing_id=${LANDING_ID}):`);
  console.log(filas.map(f => `  id=${f.id} ${f.page_type}/${f.tipo}`).join('\n'));

  if (filas.length === 0) {
    console.log('Nada para borrar.');
    return;
  }

  const t = await sequelize.transaction();
  try {
    await sequelize.query(
      `DELETE FROM landing_secciones WHERE landing_id = ${LANDING_ID}`,
      { transaction: t }
    );
    await t.commit();
    console.log('\nListo — la landing quedó sin secciones guardadas. Se reconstruye sola al abrir el editor.');
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

resetear()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
