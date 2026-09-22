'use strict';

/**
 * Borra las landings legacy de tipo_pagina='funnel'.
 *
 * Estas filas pertenecen al módulo viejo de embudos sobre la tabla `landings`.
 * No toca el Page Builder nuevo (`builder_funnels`) ni pedidos reales:
 * `envios.landing_id` se pasa a NULL para conservar ventas históricas.
 *
 * Vista previa:
 *   node scripts/eliminar-landings-funnel-legacy.js
 *
 * Ejecutar borrado:
 *   node scripts/eliminar-landings-funnel-legacy.js --apply
 */

require('dotenv').config();

const { QueryTypes } = require('sequelize');
const sequelize = require('../src/config/database');

const aplicar = process.argv.includes('--apply');

async function contar(tabla, ids) {
  const [fila] = await sequelize.query(
    `SELECT COUNT(*)::int AS total FROM ${tabla} WHERE landing_id IN (:ids)`,
    { replacements: { ids }, type: QueryTypes.SELECT }
  );
  return Number(fila.total || 0);
}

async function main() {
  const funnels = await sequelize.query(
    `SELECT l.id, l.nombre, l.slug, l.activo, l.tienda_id, t.subdominio
       FROM landings l
       LEFT JOIN tiendas t ON t.id = l.tienda_id
      WHERE l.tipo_pagina = 'funnel'
      ORDER BY l.tienda_id, l.id`,
    { type: QueryTypes.SELECT }
  );

  if (funnels.length === 0) {
    console.log('No hay landings legacy tipo_pagina=funnel para borrar.');
    return;
  }

  const ids = funnels.map(f => f.id);
  const resumen = {
    landings: funnels.length,
    landing_items: await contar('landing_items', ids),
    landing_secciones: await contar('landing_secciones', ids),
    landing_eventos: await contar('landing_eventos', ids),
    landing_beneficios: await contar('landing_beneficios', ids),
    testimonios: await contar('testimonios', ids),
    faqs: await contar('faqs', ids),
    envios_desacoplados: await contar('envios', ids),
    meta_campanas_desacopladas: await contar('meta_campanas_internas', ids),
  };

  console.log('Landings legacy tipo_pagina=funnel encontradas:');
  for (const f of funnels) {
    console.log(`  #${f.id} tienda=${f.subdominio || f.tienda_id} activo=${f.activo} "${f.nombre}" (${f.slug})`);
  }
  console.log('\nImpacto:');
  for (const [k, v] of Object.entries(resumen)) console.log(`  ${k}: ${v}`);

  if (!aplicar) {
    console.log('\nVista previa solamente. Para borrar, ejecutar con --apply.');
    return;
  }

  await sequelize.transaction(async (transaction) => {
    await sequelize.query(
      'UPDATE envios SET landing_id = NULL WHERE landing_id IN (:ids)',
      { replacements: { ids }, transaction }
    );
    await sequelize.query(
      'UPDATE meta_campanas_internas SET landing_id = NULL WHERE landing_id IN (:ids)',
      { replacements: { ids }, transaction }
    );

    for (const tabla of [
      'landing_eventos',
      'landing_items',
      'landing_secciones',
      'landing_beneficios',
      'testimonios',
      'faqs',
    ]) {
      await sequelize.query(
        `DELETE FROM ${tabla} WHERE landing_id IN (:ids)`,
        { replacements: { ids }, transaction }
      );
    }

    await sequelize.query(
      'DELETE FROM landings WHERE id IN (:ids) AND tipo_pagina = \'funnel\'',
      { replacements: { ids }, transaction }
    );
  });

  console.log(`\nListo. Se borraron ${funnels.length} landings legacy de tipo funnel.`);
}

main()
  .then(() => sequelize.close())
  .catch(async (err) => {
    console.error('Error eliminando landings funnel legacy:', err);
    try { await sequelize.close(); } catch (_) {}
    process.exit(1);
  });
