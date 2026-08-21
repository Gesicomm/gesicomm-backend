require('dotenv').config({ path: __dirname + '/../.env' });
const { sequelize, LandingTemplate } = require('../src/models');

/**
 * Templates de EMBUDO (kind='funnel') — un embudo es una página de un solo
 * producto, pensada para llevar al comprador de la visita al checkout.
 *
 * Son rígidos igual que los templates de landing de tienda: la estructura
 * vive en el componente React (pages/funnel/templates/), NO en el `schema`
 * JSON de acá. El comercio solo edita contenido, nunca el orden ni qué
 * secciones existen. Por eso `schema` queda vacío a propósito — dejarlo
 * poblado invitaría a creer que se puede reordenar desde la base.
 *
 * kind='funnel' los mantiene fuera del selector de /landing (que pide
 * ?kind=rigido) y viceversa.
 */
const TEMPLATES = [
  {
    name: 'Venta Directa',
    slug: 'venta-directa',
    description: 'Una sola decisión: entender el producto y comprarlo. Producto, precio, oferta y compra sin distracciones, sin order bump ni upsell.',
    funnel_type: 'direct_sale',
    kind: 'funnel',
    version: 1,
    status: 'published',
    schema: [],
    design_tokens: {
      acento: '#111827',
      acento_secundario: '#FFFFFF',
      modo: 'claro',
    },
  },
];

(async () => {
  try {
    await sequelize.authenticate();
    console.log('Autenticado a la BD.');

    for (const tpl of TEMPLATES) {
      const existente = await LandingTemplate.findOne({ where: { slug: tpl.slug } });
      if (existente) {
        await existente.update(tpl);
        console.log(`Actualizado: ${tpl.name} (${tpl.slug})`);
      } else {
        await LandingTemplate.create(tpl);
        console.log(`Creado: ${tpl.name} (${tpl.slug})`);
      }
    }

    console.log('Templates de embudo sembrados correctamente.');
    process.exit(0);
  } catch (err) {
    console.error('Error sembrando templates de embudo:', err);
    process.exit(1);
  }
})();
