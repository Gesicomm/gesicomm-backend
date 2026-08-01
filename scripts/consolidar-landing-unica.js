'use strict';

/**
 * Consolidación de datos — MVP pasó a permitir una sola landing por
 * tienda (ver landing.service.js, MAX_LANDINGS_POR_TIENDA=1). Este script
 * ajusta lo que ya existía en la base ANTES de ese cambio: tiendas con
 * más de una landing, o con su única landing activa marcada es_home=false
 * (el bug real que motivó todo esto: la landing terminaba sirviéndose en
 * /l/:slug en vez de /l).
 *
 * Por tienda:
 *   - 0 o 1 landing, ya es_home=true → no toca nada.
 *   - 1 landing con es_home=false → la fuerza a es_home=true (no borra nada).
 *   - 2+ landings → conserva UNA (prioridad: activa > es_home=true > la
 *     editada más recientemente) y borra el resto — con sus LandingItem y
 *     LandingEvento en cascada (mismo camino que Landing.destroy() ya usa
 *     en landing.service.js eliminar(), la FK ya tiene ON DELETE CASCADE).
 *
 * Genérico — corre sobre cualquier tienda en ese estado, no hardcodeado a
 * ninguna en particular. Idempotente: correrlo de nuevo no hace nada.
 * Ejecutar: node scripts/consolidar-landing-unica.js
 */

const { sequelize, Landing, Tienda } = require('../src/models');

function elegirSobreviviente(landings) {
  return [...landings].sort((a, b) => {
    if (a.activo !== b.activo) return a.activo ? -1 : 1;
    if (a.es_home !== b.es_home) return a.es_home ? -1 : 1;
    return new Date(b.updated_at) - new Date(a.updated_at);
  })[0];
}

async function consolidar() {
  const tiendas = await Tienda.findAll({ attributes: ['id', 'subdominio'] });
  let tocadas = 0;

  for (const tienda of tiendas) {
    const landings = await Landing.findAll({ where: { tienda_id: tienda.id } });
    if (landings.length === 0) continue;

    if (landings.length === 1) {
      const [unica] = landings;
      if (!unica.es_home) {
        unica.es_home = true;
        await unica.save();
        console.log(`  ✓ Tienda "${tienda.subdominio}": landing #${unica.id} pasada a es_home=true.`);
        tocadas++;
      }
      continue;
    }

    const sobreviviente = elegirSobreviviente(landings);
    const aBorrar = landings.filter(l => l.id !== sobreviviente.id);

    const t = await sequelize.transaction();
    try {
      if (!sobreviviente.es_home) sobreviviente.es_home = true;
      await sobreviviente.save({ transaction: t });

      for (const landing of aBorrar) {
        await landing.destroy({ transaction: t });
      }

      await t.commit();
      console.log(
        `  ✓ Tienda "${tienda.subdominio}": conservada landing #${sobreviviente.id} ` +
        `("${sobreviviente.nombre}", activo=${sobreviviente.activo}), ` +
        `borradas: ${aBorrar.map(l => `#${l.id} "${l.nombre}"`).join(', ')}.`
      );
      tocadas++;
    } catch (err) {
      await t.rollback();
      console.error(`  ❌ Tienda "${tienda.subdominio}": falló la consolidación —`, err.message);
    }
  }

  console.log(tocadas > 0 ? `\nListo — ${tocadas} tienda(s) ajustada(s).` : '\nNada que ajustar — todas las tiendas ya cumplían.');
}

consolidar()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error durante la consolidación:', err.message);
    process.exit(1);
  });
