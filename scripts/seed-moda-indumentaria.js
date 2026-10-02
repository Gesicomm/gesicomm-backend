'use strict';
require('dotenv').config();
const { sequelize, LandingTemplate } = require('../src/models');
const template = { slug: 'moda-indumentaria', name: 'Moda e Indumentaria', description: 'Diseño editorial para prendas, talles reales, telas, looks y guía de medidas editable.', funnel_type: 'direct_sale', schema: ['header', 'hero', 'productos', 'beneficios', 'contenido_adicional', 'faq', 'footer'], design_tokens: { acento: '#E4513D', fondo: '#FBFAF7', texto: '#171615', modo: 'claro' } };
async function seed() {
  try {
    const [row, created] = await LandingTemplate.findOrCreate({ where: { slug: template.slug }, defaults: { ...template, kind: 'rigido', status: 'published' } });
    if (!created) await row.update({ ...template, kind: 'rigido', status: 'published' });
    console.log(`Template ${template.slug}: ${created ? 'creado' : 'actualizado'} (id ${row.id}).`);
  } finally { await sequelize.close(); }
}
seed().catch(error => { console.error(error.message); process.exitCode = 1; });
