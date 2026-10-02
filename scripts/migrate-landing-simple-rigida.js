'use strict';

/**
 * Script de migración — Landings con templates rígidos (Fitness/Beauty/Tech).
 *
 * Agrega:
 *   - landing_templates.kind  VARCHAR(20) NOT NULL DEFAULT 'flexible'
 *     (VARCHAR + validación en la app, no ENUM de Postgres — mismo criterio
 *     que migrate-landing-tipo-pagina.js).
 *   - landings.logo_imagen, contacto_whatsapp, contacto_telefono,
 *     contacto_email, contacto_direccion, contacto_instagram,
 *     contenido_titulo, contenido_texto — todas nullable, sin default
 *     (contenido propio de cada landing rígida, ver landingSimple.service.js).
 *   - tabla landing_beneficios (id, landing_id, titulo, texto, orden) —
 *     tarjetas editables de la sección "Beneficios".
 *
 * Colores (tema único por landing, no por sección): reutiliza las columnas
 * color_primario/color_fondo/color_texto que ya existían en "landings"
 * (sistema flexible) — no hace falta migrarlas de nuevo acá.
 *
 * Y siembra (upsert por slug, no destructivo) las 3 filas de
 * landing_templates con kind='rigido' que alimentan el selector de
 * templates rígidos.
 *
 * Sin `references`/FK a nivel Postgres — misma convención que el resto del
 * proyecto. DDL puntual vía QueryInterface, dentro de UNA transacción.
 * Idempotente: se puede correr más de una vez sin romper nada.
 *
 * Ejecutar: node scripts/migrate-landing-simple-rigida.js
 */

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize, LandingTemplate, Landing, LandingBeneficio } = require('../src/models');

// Mismo copy/íconos que DEFAULTS_POR_TEMPLATE en landingSimple.service.js —
// duplicado a propósito: una migración es una foto fija en el tiempo, no
// debe depender de que el código de la app no cambie más adelante.
const DEFAULTS_POR_TEMPLATE = {
  'fitness-suplementos': {
    contenido_titulo: 'Nutrición pensada para tu objetivo',
    contenido_texto: 'Ya sea que busques ganar masa, definir o mejorar tu rendimiento, tenemos la combinación de suplementos justa para vos.',
    beneficios: [
      { titulo: 'Calidad certificada', texto: 'Fórmulas probadas, sin rellenos.', icono: 'shield' },
      { titulo: 'Envío rápido', texto: 'Recibilo en la puerta de tu casa.', icono: 'truck' },
      { titulo: 'Resultados reales', texto: 'Pensado para quien entrena en serio.', icono: 'flame' },
    ],
  },
  'beauty-skincare': {
    contenido_titulo: 'Rituales de belleza que se disfrutan',
    contenido_texto: 'Seleccionamos cada producto pensando en rutinas simples, efectivas y que te hagan sentir bien con vos misma.',
    beneficios: [
      { titulo: 'Ingredientes naturales', texto: 'Fórmulas suaves, libres de crueldad animal.', icono: 'leaf' },
      { titulo: 'Para cada tipo de piel', texto: 'Rutinas pensadas a tu medida.', icono: 'heart' },
      { titulo: 'Envío a domicilio', texto: 'Recibí tu pedido sin salir de casa.', icono: 'truck' },
    ],
  },
  'tech-electronica': {
    contenido_titulo: 'Innovación a un clic de distancia',
    contenido_texto: 'Seleccionamos los mejores gadgets y accesorios para que siempre estés a la vanguardia.',
    beneficios: [
      { titulo: 'Garantía oficial', texto: 'Productos originales, con respaldo.', icono: 'badge' },
      { titulo: 'Envío asegurado', texto: 'Seguimiento en tiempo real de tu pedido.', icono: 'truck' },
      { titulo: 'Última generación', texto: 'Lo nuevo en tecnología, siempre.', icono: 'zap' },
    ],
  },
  'basico': {
    contenido_titulo: 'Pensado para vos',
    contenido_texto: 'Seleccionamos cuidadosamente cada producto para que encuentres justo lo que necesitás, sin vueltas.',
    beneficios: [
      { titulo: 'Compra segura', texto: 'Pagos y datos siempre protegidos.', icono: 'shield' },
      { titulo: 'Envío a domicilio', texto: 'Recibilo donde estés.', icono: 'truck' },
      { titulo: 'Atención personalizada', texto: 'Te ayudamos en cada paso.', icono: 'headphones' },
    ],
  },
};

const TEMPLATES_RIGIDOS = [
  { slug: 'moda-indumentaria', name: 'Moda e Indumentaria', description: 'Diseño editorial para prendas, talles reales, telas, looks y guía de medidas editable.', funnel_type: 'direct_sale', schema: ['header', 'hero', 'productos', 'beneficios', 'contenido_adicional', 'faq', 'footer'], design_tokens: { acento: '#E4513D', fondo: '#FBFAF7', texto: '#171615', modo: 'claro' } },
  { slug: 'bazar-hogar', name: 'Bazar Jobar · Hogar y Decoración', description: 'Bazar, textiles, cocina y decoración: materiales, medidas, ambientes y paquetes editables.', funnel_type: 'direct_sale', schema: ['header', 'hero', 'productos', 'beneficios', 'faq', 'footer'], design_tokens: { acento: '#A95843', acento_secundario: '#66705A', fondo: '#FBFAF7', texto: '#292722', modo: 'claro' } },
  {
    slug: 'fitness-suplementos',
    name: 'Fitness & Suplementos',
    description: 'Gimnasios, suplementos, proteínas, creatina, pre-entrenos, nutrición deportiva.',
    funnel_type: 'direct_sale',
    schema: [
      'header', 'hero', 'beneficios', 'productos', 'contenido_adicional',
      'contacto', 'faq', 'cta', 'footer',
    ],
    design_tokens: { acento: '#FF5A1F', acento_secundario: '#111827', modo: 'oscuro' },
  },
  {
    slug: 'beauty-skincare',
    name: 'Beauty & Skin Care',
    description: 'Skincare, cosmética, maquillaje, cuidado facial y corporal.',
    funnel_type: 'direct_sale',
    schema: [
      'header', 'hero', 'beneficios', 'productos', 'contenido_adicional',
      'contacto', 'faq', 'cta', 'footer',
    ],
    design_tokens: { acento: '#E8A2B0', acento_secundario: '#FBEFEF', modo: 'claro' },
  },
  {
    slug: 'tech-electronica',
    name: 'Electrónica & Tecnología',
    description: 'Celulares, gadgets, accesorios, informática, electrónica.',
    funnel_type: 'direct_sale',
    schema: [
      'header', 'hero', 'beneficios', 'productos', 'contenido_adicional',
      'contacto', 'faq', 'cta', 'footer',
    ],
    design_tokens: { acento: '#3AB0FF', acento_secundario: '#0B1220', modo: 'oscuro' },
  },
  {
    slug: 'basico',
    name: 'Básico',
    description: 'Diseño neutro, fondo blanco y texto negro — para cualquier tipo de negocio.',
    funnel_type: 'direct_sale',
    schema: [
      'header', 'hero', 'beneficios', 'productos', 'contenido_adicional',
      'contacto', 'faq', 'cta', 'footer',
    ],
    design_tokens: { acento: '#000000', acento_secundario: '#FFFFFF', modo: 'claro' },
  },
];

// describeTable hace una consulta pesada contra information_schema (varias
// subconsultas correlacionadas) — sobre un túnel SSH de alta latencia, una
// llamada por columna es lentísimo. Se llama UNA vez por tabla y se
// reutiliza el resultado para decidir qué columnas faltan.
async function agregarColumnasFaltantes(qi, tabla, columnasNuevas, t) {
  const columnasActuales = await qi.describeTable(tabla);
  for (const [columna, definicion] of Object.entries(columnasNuevas)) {
    if (columnasActuales[columna]) {
      console.log(`  "${tabla}.${columna}" ya existe, se omite.`);
      continue;
    }
    await qi.addColumn(tabla, columna, definicion, { transaction: t });
    console.log(`  ✓ "${tabla}.${columna}" agregada.`);
  }
}

async function migrar() {
  const qi = sequelize.getQueryInterface();
  const t = await sequelize.transaction();

  try {
    await agregarColumnasFaltantes(qi, 'landing_templates', {
      kind: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'flexible' },
    }, t);

    await agregarColumnasFaltantes(qi, 'landings', {
      logo_imagen: { type: DataTypes.STRING(255), allowNull: true },
      contacto_whatsapp: { type: DataTypes.STRING(50), allowNull: true },
      contacto_telefono: { type: DataTypes.STRING(50), allowNull: true },
      contacto_email: { type: DataTypes.STRING(150), allowNull: true },
      contacto_direccion: { type: DataTypes.STRING(255), allowNull: true },
      contacto_instagram: { type: DataTypes.STRING(100), allowNull: true },
      contacto_facebook: { type: DataTypes.STRING(100), allowNull: true },
      contenido_titulo: { type: DataTypes.STRING(150), allowNull: true },
      contenido_texto: { type: DataTypes.TEXT, allowNull: true },
      banner_opacidad: { type: DataTypes.INTEGER, allowNull: true },
      productos_titulo: { type: DataTypes.STRING(150), allowNull: true },
      catalogo_descripcion: { type: DataTypes.STRING(300), allowNull: true },
      catalogo_titulo: { type: DataTypes.STRING(150), allowNull: true },
      contacto_ciudad: { type: DataTypes.STRING(100), allowNull: true },
      contacto_pais: { type: DataTypes.STRING(100), allowNull: true },
      contacto_horarios: { type: DataTypes.STRING(255), allowNull: true },
    }, t);

    await agregarColumnasFaltantes(qi, 'landing_items', {
      mostrar_en_inicio: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    }, t);

    const tablas = await qi.showAllTables();
    if (!tablas.includes('landing_beneficios')) {
      await qi.createTable('landing_beneficios', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        landing_id: { type: DataTypes.INTEGER, allowNull: false },
        titulo: { type: DataTypes.STRING(100), allowNull: false },
        texto: { type: DataTypes.STRING(300), allowNull: false },
        icono: { type: DataTypes.STRING(30), allowNull: true },
        orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false },
      }, { transaction: t });
      await qi.addIndex('landing_beneficios', ['landing_id'], { transaction: t });
      console.log('  ✓ tabla "landing_beneficios" creada.');
    } else {
      console.log('  tabla "landing_beneficios" ya existe, se omite.');
    }

    await agregarColumnasFaltantes(qi, 'landing_beneficios', {
      icono: { type: DataTypes.STRING(30), allowNull: true },
    }, t);

    await t.commit();
    console.log('\nColumnas migradas.');
  } catch (err) {
    await t.rollback();
    throw err;
  }

  for (const tpl of TEMPLATES_RIGIDOS) {
    const [row, creado] = await LandingTemplate.findOrCreate({
      where: { slug: tpl.slug },
      defaults: {
        name: tpl.name,
        description: tpl.description,
        funnel_type: tpl.funnel_type,
        kind: 'rigido',
        status: 'published',
        schema: tpl.schema,
        design_tokens: tpl.design_tokens,
      },
    });
    if (creado) {
      console.log(`  ✓ template "${tpl.slug}" creado.`);
    } else if (row.kind !== 'rigido' || row.status !== 'published') {
      await row.update({ kind: 'rigido', status: 'published' });
      console.log(`  ✓ template "${tpl.slug}" ya existía, normalizado kind/status.`);
    } else {
      console.log(`  template "${tpl.slug}" ya existe, se omite.`);
    }
  }

  // Backfill: landings rígidas que quedaron sin beneficios/contenido
  // adicional (creadas antes de que este script sembrara esos defaults al
  // crear()) — sin esto, para el comercio se "veían" beneficios en el
  // preview (venían hardcodeados en el componente React) que en realidad
  // nunca se habían guardado; al sacar ese fallback del frontend, esas
  // landings quedaban con la sección vacía de la nada. Solo toca landings
  // con CERO filas en landing_beneficios — nunca pisa contenido que el
  // comercio ya haya guardado a mano.
  const landingsRigidas = await Landing.findAll({
    include: [{ model: LandingTemplate, as: 'template', required: true, where: { kind: 'rigido' } }],
  });
  let backfilleadas = 0;
  for (const landing of landingsRigidas) {
    const defaults = DEFAULTS_POR_TEMPLATE[landing.template.slug];
    if (!defaults) continue;
    const cantidadBeneficios = await LandingBeneficio.count({ where: { landing_id: landing.id } });
    if (cantidadBeneficios > 0) continue;

    await LandingBeneficio.bulkCreate(defaults.beneficios.map((b, idx) => ({
      landing_id: landing.id,
      titulo: b.titulo,
      texto: b.texto,
      icono: b.icono,
      orden: idx,
    })));
    if (!landing.contenido_titulo && !landing.contenido_texto) {
      await landing.update({ contenido_titulo: defaults.contenido_titulo, contenido_texto: defaults.contenido_texto });
    }
    backfilleadas++;
  }
  console.log(`\n  ✓ ${backfilleadas} landing(s) rígida(s) con beneficios/contenido de default rellenados.`);

  console.log('\nMigración + seed completados.');
}

migrar()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error durante la migración:', err.message);
    process.exit(1);
  });
