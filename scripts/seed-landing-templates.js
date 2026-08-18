require('dotenv').config({ path: __dirname + '/../.env' });
const { sequelize, LandingTemplate } = require('../src/models');

const TEMPLATES = [
  {
    name: 'Venta Directa Clásica',
    slug: 'direct-sale-v1',
    description: 'Ideal para productos simples y compras impulsivas.',
    funnel_type: 'direct_sale',
    version: 1,
    status: 'published',
    schema: [
      { id: 'header', type: 'header', required: true },
      { id: 'hero', type: 'hero', required: true, settings: { show_price: true } },
      { id: 'benefits', type: 'beneficios', required: true, max_items: 3 },
      { id: 'order_bump', type: 'order_bump', required: false, is_commerce: true },
      { id: 'testimonials', type: 'testimonios', required: false },
      { id: 'footer', type: 'footer', required: true }
    ],
    design_tokens: {
      colorScheme: 'light',
      borderRadius: 'mediano',
      fontFamily: 'outfit'
    }
  },
  {
    name: 'Venta Educativa',
    slug: 'educational-v1',
    description: 'Ideal para productos que necesitan explicación (ej. salud, innovación).',
    funnel_type: 'educational',
    version: 1,
    status: 'published',
    schema: [
      { id: 'header', type: 'header', required: true },
      { id: 'hero_problem', type: 'hero', required: true, settings: { subtitle_as_problem: true } },
      { id: 'how_it_works', type: 'como_funciona', required: true },
      { id: 'benefits', type: 'beneficios', required: true },
      { id: 'faq', type: 'faq', required: true },
      { id: 'cta_final', type: 'cta', required: true, is_commerce: true },
      { id: 'footer', type: 'footer', required: true }
    ],
    design_tokens: {
      colorScheme: 'dark',
      borderRadius: 'chico',
      fontFamily: 'inter'
    }
  },
  {
    name: 'Lifestyle y Estética',
    slug: 'lifestyle-v1',
    description: 'Ideal para moda, decoración y productos visuales.',
    funnel_type: 'lifestyle',
    version: 1,
    status: 'published',
    schema: [
      { id: 'header', type: 'header', required: true },
      { id: 'banner_season', type: 'banner', required: true, settings: { height: 'lg' } },
      { id: 'brand_statement', type: 'announcement_bar', required: false },
      { id: 'gallery', type: 'destacados', required: true },
      { id: 'cross_sell', type: 'productos', required: false, is_commerce: true },
      { id: 'footer', type: 'footer', required: true }
    ],
    design_tokens: {
      colorScheme: 'light',
      borderRadius: 'grande',
      fontFamily: 'poppins'
    }
  }
];

(async () => {
  try {
    await sequelize.authenticate();
    console.log('Autenticado a la BD.');

    for (const tpl of TEMPLATES) {
      // Upsert by slug manually since upsert looks at PK by default
      const existing = await LandingTemplate.findOne({ where: { slug: tpl.slug } });
      if (existing) {
        await existing.update(tpl);
      } else {
        await LandingTemplate.create(tpl);
      }
    }
    
    console.log('Plantillas (Funnels) sembradas exitosamente.');
    process.exit(0);
  } catch (err) {
    console.error('Error sembrando plantillas:', err);
    process.exit(1);
  }
})();
