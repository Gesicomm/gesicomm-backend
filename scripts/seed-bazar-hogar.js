'use strict';
require('dotenv').config();
const { sequelize, LandingTemplate } = require('../src/models');
const template = { slug: 'bazar-hogar', name: 'Bazar Jobar · Hogar y Decoración', description: 'Bazar, textiles, cocina y decoración: materiales, medidas, ambientes y paquetes editables.', funnel_type: 'direct_sale', schema: ['header', 'hero', 'productos', 'beneficios', 'faq', 'footer'], design_tokens: { acento: '#A95843', acento_secundario: '#66705A', fondo: '#FBFAF7', texto: '#292722', modo: 'claro' } };
async function seed() {
  try {
    const [row, created] = await LandingTemplate.findOrCreate({ where: { slug: template.slug }, defaults: { ...template, kind: 'rigido', status: 'published' } });
    if (!created) await row.update({ ...template, kind: 'rigido', status: 'published' });
    console.log(`Template ${template.slug}: ${created ? 'creado' : 'actualizado'} (id ${row.id}).`);
  } finally { await sequelize.close(); }
}
seed().catch(error => { console.error(error.message); process.exitCode = 1; });
