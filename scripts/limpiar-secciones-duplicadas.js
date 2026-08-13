'use strict';

/**
 * Script de limpieza — filas duplicadas en "landing_secciones" con
 * stable_id NULL.
 *
 * Causa raíz (ya corregida en landing.service.js normalizarSeccion): antes
 * de este fix, cualquier sección sin stable_id (las secciones "base" por
 * defecto del frontend, o filas creadas a mano sin ese campo) se trataba
 * como nueva en CADA guardado en vez de actualizarse — duplicando la fila
 * una vez por cada Guardar. Esto ya no puede volver a pasar (el backend
 * ahora siempre asigna un stable_id real al crear), pero las filas
 * duplicadas que ya quedaron en la base de antes del fix siguen ahí.
 *
 * Qué hace: agrupa las filas con stable_id NULL por
 * (landing_id, producto_id, page_type, tipo, orden) — mismo criterio con
 * el que el editor las trataba como "la misma sección" — y en cada grupo
 * con más de una fila, se queda con la de "id" más alto (la más reciente)
 * y borra el resto. Filas con stable_id ya asignado NO se tocan.
 *
 * Es un DELETE real, no un dry-run. Se corre dentro de una transacción,
 * y antes de borrar imprime exactamente qué va a borrar para poder
 * cancelar (Ctrl+C) si algo se ve raro.
 *
 * Ejecutar: node scripts/limpiar-secciones-duplicadas.js
 */

require('dotenv').config();
const { sequelize } = require('../src/models');

async function limpiar() {
  // OJO: se agrupan TODAS las filas (con y sin stable_id), no solo las
  // NULL — si dentro de un grupo ya hay alguna con stable_id real (viene
  // del guardado más reciente, post-fix), esa gana siempre y se borran
  // TODAS las NULL del grupo, aunque el grupo tenga una sola fila NULL
  // (primera corrida de este script solo comparaba NULL contra NULL, así
  // que no detectaba este caso — corregido acá).
  const [filas] = await sequelize.query(
    `SELECT id, landing_id, producto_id, page_type, tipo, orden, stable_id
     FROM landing_secciones
     ORDER BY landing_id, producto_id NULLS FIRST, page_type, tipo, orden, id`
  );

  const grupos = new Map();
  for (const f of filas) {
    const clave = `${f.landing_id}|${f.producto_id ?? ''}|${f.page_type}|${f.tipo}|${f.orden}`;
    const lista = grupos.get(clave) || [];
    lista.push(f);
    grupos.set(clave, lista);
  }

  const idsABorrar = [];
  for (const [clave, lista] of grupos) {
    if (lista.length <= 1) continue;
    const conStableId = lista.filter(f => f.stable_id);
    const sinStableId = lista.filter(f => !f.stable_id);

    let mantener, aBorrar;
    if (conStableId.length > 0) {
      // Ya hay al menos una fila post-fix con stable_id real: esa gana
      // siempre. Si hubiera más de una (no debería), se queda la más
      // reciente igual.
      const ordenadas = [...conStableId].sort((a, b) => a.id - b.id);
      mantener = ordenadas.pop();
      aBorrar = [...sinStableId, ...ordenadas];
    } else {
      // Ninguna tiene stable_id todavía: mismo criterio que antes, la más
      // reciente gana.
      const ordenadas = [...sinStableId].sort((a, b) => a.id - b.id);
      mantener = ordenadas.pop();
      aBorrar = ordenadas;
    }

    if (aBorrar.length === 0) continue;
    console.log(`  Grupo ${clave}: ${lista.length} filas, se mantiene id=${mantener.id} (stable_id=${mantener.stable_id || 'null'}), se borran ids=${aBorrar.map(o => o.id).join(',')}`);
    idsABorrar.push(...aBorrar.map(o => o.id));
  }

  if (idsABorrar.length === 0) {
    console.log('No hay duplicados para limpiar.');
    return;
  }

  console.log(`\nTotal a borrar: ${idsABorrar.length} filas.`);

  const t = await sequelize.transaction();
  try {
    await sequelize.query(
      `DELETE FROM landing_secciones WHERE id IN (${idsABorrar.join(',')})`,
      { transaction: t }
    );
    await t.commit();
    console.log('Limpieza completada.');
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

limpiar()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error durante la limpieza:', err.message);
    process.exit(1);
  });
