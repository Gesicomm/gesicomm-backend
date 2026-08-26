/**
 * Siembra el template del "Lienzo en blanco" — la fila de landing_templates
 * con kind='codigo' que habilita el modo de armar la landing escribiendo
 * HTML/CSS/JS a mano (ver services/landingCodigo.service.js).
 *
 * Es UNA sola fila, global (no por tienda) y sin schema de secciones: el
 * modo código no tiene estructura que declarar. Sin esta fila,
 * POST /api/mis-landings-simples/lienzo-blanco responde 400 con el mensaje
 * que apunta a este script.
 *
 * Idempotente: si el slug ya existe, solo actualiza nombre/descripcion/kind.
 * No toca ninguna Landing existente.
 *
 *   node scripts/seed-landing-lienzo-blanco.js
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const { sequelize, LandingTemplate } = require('../src/models');

const TEMPLATE = {
  name: 'Lienzo en blanco',
  slug: 'lienzo-blanco',
  description: 'Sin estructura: escribís vos el HTML, el CSS y el JavaScript de la landing.',
  funnel_type: 'direct_sale',
  kind: 'codigo',
  version: 1,
  status: 'published',
  schema: [],
};

async function main() {
  await sequelize.authenticate();

  const existente = await LandingTemplate.findOne({ where: { slug: TEMPLATE.slug } });
  if (existente) {
    await existente.update({
      name: TEMPLATE.name,
      description: TEMPLATE.description,
      kind: TEMPLATE.kind,
      status: TEMPLATE.status,
    });
    console.log(`[seed] Template "${TEMPLATE.slug}" ya existía (id=${existente.id}) — actualizado.`);
  } else {
    const creado = await LandingTemplate.create(TEMPLATE);
    console.log(`[seed] Template "${TEMPLATE.slug}" creado (id=${creado.id}).`);
  }

  await sequelize.close();
}

main().catch(async (err) => {
  console.error('[seed] Error:', err.message);
  try { await sequelize.close(); } catch (e) { /* ya cerrada */ }
  process.exit(1);
});
