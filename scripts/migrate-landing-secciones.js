'use strict';

/**
 * Script de migracion - secciones editables por landing.
 *
 * Crea "landing_secciones", la base para que la tienda publica se renderice
 * como un builder tipo Shopify: header, barras, productos, FAQ, footer, etc.
 *
 * Idempotente:
 * - si la tabla ya existe, no la recrea;
 * - si una landing ya tiene secciones, no la toca;
 * - si no tiene, crea una estructura default desde los campos actuales.
 *
 * Ejecutar: node scripts/migrate-landing-secciones.js
 */

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize, Landing, LandingSeccion, LandingItem, Testimonio, Faq } = require('../src/models');

const TIPOS = [
  'header',
  'announcement_bar',
  'hero',
  'beneficios',
  'categorias',
  'destacados',
  'productos',
  'banner',
  'texto',
  'como_funciona',
  'faq',
  'testimonios',
  'redes_sociales',
  'footer',
];

function seccionesDefault(landing, { cantidadItems, cantidadTestimonios, cantidadFaq }) {
  const rows = [
    {
      tipo: 'header',
      nombre_interno: 'Header principal',
      activo: true,
      orden: 0,
      config_json: {
        sticky: true,
        mostrar_busqueda: true,
        mostrar_carrito: true,
        mostrar_cuenta: false,
      },
      contenido_json: {
        logo_texto: landing.titulo || landing.nombre,
        links: [
          { label: 'Inicio', href: '#inicio' },
          { label: 'Catalogo', href: '#lp-productos' },
          { label: 'Contacto', href: '#lp-contacto' },
        ],
      },
    },
    {
      tipo: 'hero',
      nombre_interno: 'Hero',
      activo: true,
      orden: 10,
      config_json: {},
      contenido_json: {
        titulo: landing.titulo || landing.nombre,
        descripcion: landing.descripcion || '',
      },
    },
    { tipo: 'beneficios', nombre_interno: 'Beneficios', activo: true, orden: 20, config_json: {}, contenido_json: {} },
    { tipo: 'categorias', nombre_interno: 'Categorias', activo: true, orden: 30, config_json: {}, contenido_json: {} },
    { tipo: 'destacados', nombre_interno: 'Productos destacados', activo: true, orden: 40, config_json: {}, contenido_json: {} },
  ];

  if (landing.mostrar_banner || landing.banner_titulo || landing.banner_imagen) {
    rows.push({
      tipo: 'banner',
      nombre_interno: 'Banner',
      activo: !!(landing.mostrar_banner && (landing.banner_titulo || landing.banner_imagen)),
      orden: 50,
      config_json: {},
      contenido_json: {
        imagen: landing.banner_imagen || null,
        titulo: landing.banner_titulo || '',
        subtitulo: landing.banner_subtitulo || '',
        boton_texto: landing.banner_boton_texto || '',
        boton_link: landing.banner_boton_link || '',
      },
    });
  }

  rows.push({
    tipo: 'productos',
    nombre_interno: 'Catalogo',
    activo: cantidadItems > 0,
    orden: 60,
    config_json: {
      mostrar_buscador: !!landing.mostrar_buscador,
      mostrar_filtro_categoria: !!landing.mostrar_filtro_categoria,
      mostrar_filtro_marca: !!landing.mostrar_filtro_marca,
      mostrar_filtro_etiqueta: !!landing.mostrar_filtro_etiqueta,
      mostrar_orden_precio: !!landing.mostrar_orden_precio,
    },
    contenido_json: {
      titulo: 'Todos los productos',
    },
  });

  rows.push(
    {
      tipo: 'testimonios',
      nombre_interno: 'Opiniones',
      activo: !!landing.mostrar_testimonios && cantidadTestimonios > 0,
      orden: 70,
      config_json: {},
      contenido_json: { titulo: 'Opiniones de clientes' },
    },
    {
      tipo: 'faq',
      nombre_interno: 'Preguntas frecuentes',
      activo: !!landing.mostrar_faq && cantidadFaq > 0,
      orden: 80,
      config_json: {},
      contenido_json: { titulo: 'Preguntas frecuentes' },
    },
    {
      tipo: 'footer',
      nombre_interno: 'Footer',
      activo: true,
      orden: 90,
      config_json: {},
      contenido_json: {
        titulo: landing.titulo || landing.nombre,
        descripcion: landing.descripcion || '',
        links: [
          { label: 'Productos', href: '#lp-productos' },
          { label: 'Contacto', href: '#lp-contacto' },
        ],
      },
    }
  );

  return rows.map(row => ({ landing_id: landing.id, ...row }));
}

async function migrar() {
  const qi = sequelize.getQueryInterface();
  const tablas = await qi.showAllTables();

  if (!tablas.includes('landing_secciones')) {
    await qi.createTable('landing_secciones', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      landing_id: { type: DataTypes.INTEGER, allowNull: false },
      tipo: { type: DataTypes.ENUM(...TIPOS), allowNull: false },
      nombre_interno: { type: DataTypes.STRING(120), allowNull: true },
      activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      config_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      contenido_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await qi.addIndex('landing_secciones', ['landing_id']);
    await qi.addIndex('landing_secciones', ['landing_id', 'orden']);
    console.log('  tabla "landing_secciones" creada.');
  } else {
    console.log('  "landing_secciones" ya existe, se omite.');
  }

  const landings = await Landing.findAll({ order: [['id', 'ASC']] });
  let creadas = 0;

  for (const landing of landings) {
    const existentes = await LandingSeccion.count({ where: { landing_id: landing.id } });
    if (existentes > 0) continue;

    const [cantidadItems, cantidadTestimonios, cantidadFaq] = await Promise.all([
      LandingItem.count({ where: { landing_id: landing.id } }),
      Testimonio.count({ where: { landing_id: landing.id } }),
      Faq.count({ where: { landing_id: landing.id } }),
    ]);

    const rows = seccionesDefault(landing, { cantidadItems, cantidadTestimonios, cantidadFaq });
    await LandingSeccion.bulkCreate(rows);
    creadas += rows.length;
  }

  console.log(`\nMigracion completada. Secciones creadas: ${creadas}.`);
}

migrar()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error durante la migracion:', err.message);
    process.exit(1);
  });
