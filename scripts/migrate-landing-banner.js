'use strict';

/**
 * Script de migración — banner principal por landing.
 *
 * El tema (colores) y el contacto siguen siendo compartidos vía Tienda
 * (ver comentario en models/Landing.js) — pero el banner es contenido
 * propio de CADA landing curada, no algo que tenga sentido compartir
 * entre todas: es lo primero que ve el visitante de esa selección
 * puntual de productos.
 *
 * Agrega a "landings":
 *   - mostrar_banner       BOOLEAN NOT NULL DEFAULT false
 *   - banner_imagen        VARCHAR(255) NULL  (misma convención que ProductoImagen.url: "/uploads/archivo.jpg")
 *   - banner_titulo        VARCHAR(200) NULL
 *   - banner_subtitulo     VARCHAR(300) NULL
 *   - banner_boton_texto   VARCHAR(50)  NULL
 *   - banner_boton_link    VARCHAR(500) NULL
 *
 * Idempotente (chequea columna por columna antes de agregar) — se puede
 * correr más de una vez sin romper nada.
 *
 * Ejecutar: node scripts/migrate-landing-banner.js
 */

const { sequelize } = require('../src/models');
const { DataTypes } = require('sequelize');

async function migrar() {
  const qi = sequelize.getQueryInterface();
  const columnas = await qi.describeTable('landings');

  const nuevas = [
    ['mostrar_banner', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }],
    ['banner_imagen', { type: DataTypes.STRING(255), allowNull: true }],
    ['banner_titulo', { type: DataTypes.STRING(200), allowNull: true }],
    ['banner_subtitulo', { type: DataTypes.STRING(300), allowNull: true }],
    ['banner_boton_texto', { type: DataTypes.STRING(50), allowNull: true }],
    ['banner_boton_link', { type: DataTypes.STRING(500), allowNull: true }],
  ];

  for (const [nombre, definicion] of nuevas) {
    if (columnas[nombre]) {
      console.log(`  "${nombre}" ya existe, se omite.`);
      continue;
    }
    await qi.addColumn('landings', nombre, definicion);
    console.log(`  ✓ "${nombre}" agregada.`);
  }

  console.log('\nMigración completada.');
}

migrar()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error durante la migración:', err.message);
    process.exit(1);
  });
