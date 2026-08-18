const { LandingTemplate } = require('../src/models');

async function seedTemplates() {
  console.log('Seeding Funnel Templates...');

  const templates = [
    {
      name: 'The Converter (Alta Conversión)',
      slug: 'the-converter',
      description: 'Un embudo clásico de ventas directas. Ideal para un solo producto. Enfocado en generar confianza inmediata con beneficios, oferta irresistible y prueba social.',
      funnel_type: 'direct_sale',
      version: 1,
      status: 'published',
      preview_image: 'https://images.unsplash.com/photo-1555421689-491a97ff2040?w=800&q=80',
      schema: [
        { id: 'header', type: 'header', config: { colorScheme: 'transparent', sticky: true } },
        { id: 'hero', type: 'hero', config: { colorScheme: 'dark', template: 'split_image_text', mostrar_estadisticas: true } },
        { id: 'beneficios', type: 'beneficios', config: { colorScheme: 'light', template: '3_columns' } },
        { id: 'product_detail', type: 'product_detail', config: { colorScheme: 'default' } },
        { id: 'testimonios', type: 'testimonios', config: { colorScheme: 'accent', template: 'carousel' } },
        { id: 'faq', type: 'faq', config: { colorScheme: 'light', template: 'accordion' } },
        { id: 'footer', type: 'footer', config: { colorScheme: 'dark' } }
      ],
      design_tokens: {
        primary_color: '#0F172A',
        accent_color: '#3B82F6',
        font: 'inter',
        border_radius: 'lg'
      }
    },
    {
      name: 'The Upseller (Venta Cruzada)',
      slug: 'the-upseller',
      description: 'Maximiza el valor de cada carrito. Muestra tu producto estrella e inmediatamente sugiere accesorios o productos relacionados para aumentar el ticket promedio.',
      funnel_type: 'direct_sale',
      version: 1,
      status: 'published',
      preview_image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&q=80',
      schema: [
        { id: 'announcement_bar', type: 'announcement_bar', config: { color_fondo: '#EAB308', color_texto: '#FFFFFF' }, campos: { texto: '🔥 Envío GRATIS en compras superiores a Gs 150.000' } },
        { id: 'header', type: 'header', config: { colorScheme: 'default' } },
        { id: 'product_detail', type: 'product_detail', config: { colorScheme: 'default' } },
        { id: 'productos', type: 'productos', config: { colorScheme: 'light', template: 'carousel' }, campos: { titulo: 'Frecuentemente comprados juntos' } },
        { id: 'como_funciona', type: 'como_funciona', config: { colorScheme: 'accent', template: 'steps_horizontal' } },
        { id: 'footer', type: 'footer', config: { colorScheme: 'default' } }
      ],
      design_tokens: {
        primary_color: '#EA580C',
        accent_color: '#F97316',
        font: 'outfit',
        border_radius: 'full'
      }
    },
    {
      name: 'The Storyteller (Lanzamiento / Historia)',
      slug: 'the-storyteller',
      description: 'Crea deseo y educa a tu cliente antes de vender. Excelente para productos de salud, belleza o soluciones innovadoras que requieren mostrar el "Antes y Después".',
      funnel_type: 'lifestyle',
      version: 1,
      status: 'published',
      preview_image: 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=800&q=80',
      schema: [
        { id: 'header', type: 'header', config: { colorScheme: 'transparent' } },
        { id: 'hero', type: 'hero', config: { colorScheme: 'dark', template: 'minimal_center' } },
        { id: 'before_after', type: 'before_after', config: { colorScheme: 'light', template: 'slider' } },
        { id: 'beneficios', type: 'beneficios', config: { colorScheme: 'default', template: 'list' } },
        { id: 'testimonios', type: 'testimonios', config: { colorScheme: 'light', template: 'featured' } },
        { id: 'product_detail', type: 'product_detail', config: { colorScheme: 'accent' } },
        { id: 'footer', type: 'footer', config: { colorScheme: 'dark' } }
      ],
      design_tokens: {
        primary_color: '#047857',
        accent_color: '#10B981',
        font: 'roboto',
        border_radius: 'md'
      }
    }
  ];

  for (const tpl of templates) {
    const [template, created] = await LandingTemplate.findOrCreate({
      where: { slug: tpl.slug },
      defaults: tpl
    });

    if (!created) {
      await template.update(tpl);
      console.log(`Updated template: ${tpl.name}`);
    } else {
      console.log(`Created template: ${tpl.name}`);
    }
  }

  console.log('Seeding completed successfully.');
  process.exit(0);
}

seedTemplates().catch(err => {
  console.error('Error seeding templates:', err);
  process.exit(1);
});
