'use strict';

/**
 * Script de migración — Diseño por landing, SEO, WhatsApp avanzado y
 * analítica de tienda.
 *
 * "landings" (override visual y de metadata, propio de CADA landing):
 *   - tema_modo             ENUM('oscuro','claro') NOT NULL DEFAULT 'oscuro'
 *   - color_primario        VARCHAR(7) NULL   — override; null = hereda Tienda.color_primario
 *   - color_fondo           VARCHAR(7) NULL   — override; null = hereda Tienda.color_fondo (oscuro) o un claro por defecto
 *   - radio_bordes          ENUM('chico','mediano','grande') NOT NULL DEFAULT 'mediano'
 *   - fuente                ENUM('outfit','inter','poppins','roboto') NOT NULL DEFAULT 'outfit'
 *   - mostrar_whatsapp      BOOLEAN NOT NULL DEFAULT true
 *   - seo_titulo            VARCHAR(160) NULL
 *   - seo_descripcion       VARCHAR(320) NULL
 *   - seo_keywords          VARCHAR(300) NULL
 *   - seo_og_imagen         VARCHAR(255) NULL
 *   - whatsapp_incluir_precio VARCHAR heredado como BOOLEAN NOT NULL DEFAULT false
 *   - whatsapp_incluir_url  BOOLEAN NOT NULL DEFAULT false
 *
 * "tiendas" (analítica de cuenta — mismo nivel que meta_pixel_id, que ya
 * es compartido entre todas las landings de la tienda):
 *   - google_analytics_id   VARCHAR(20) NULL
 *   - tiktok_pixel_id       VARCHAR(30) NULL
 *
 * Idempotente. Ejecutar: node scripts/migrate-landing-diseno-seo.js
 */

const { sequelize } = require('../src/models');
const { DataTypes } = require('sequelize');

async function agregarColumnas(tabla, columnas) {
  const qi = sequelize.getQueryInterface();
  const existentes = await qi.describeTable(tabla);
  for (const [nombre, definicion] of columnas) {
    if (existentes[nombre]) {
      console.log(`  "${tabla}.${nombre}" ya existe, se omite.`);
      continue;
    }
    await qi.addColumn(tabla, nombre, definicion);
    console.log(`  ✓ "${tabla}.${nombre}" agregada.`);
  }
}

async function migrar() {
  await agregarColumnas('landings', [
    ['tema_modo', { type: DataTypes.ENUM('oscuro', 'claro'), allowNull: false, defaultValue: 'oscuro' }],
    ['color_primario', { type: DataTypes.STRING(7), allowNull: true }],
    ['color_fondo', { type: DataTypes.STRING(7), allowNull: true }],
    ['radio_bordes', { type: DataTypes.ENUM('chico', 'mediano', 'grande'), allowNull: false, defaultValue: 'mediano' }],
    ['fuente', { type: DataTypes.ENUM('outfit', 'inter', 'poppins', 'roboto'), allowNull: false, defaultValue: 'outfit' }],
    ['mostrar_whatsapp', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }],
    ['seo_titulo', { type: DataTypes.STRING(160), allowNull: true }],
    ['seo_descripcion', { type: DataTypes.STRING(320), allowNull: true }],
    ['seo_keywords', { type: DataTypes.STRING(300), allowNull: true }],
    ['seo_og_imagen', { type: DataTypes.STRING(255), allowNull: true }],
    ['whatsapp_incluir_precio', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }],
    ['whatsapp_incluir_url', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }],
  ]);

  await agregarColumnas('tiendas', [
    ['google_analytics_id', { type: DataTypes.STRING(20), allowNull: true }],
    ['tiktok_pixel_id', { type: DataTypes.STRING(30), allowNull: true }],
  ]);

  console.log('\nMigración completada.');
}

migrar()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error durante la migración:', err.message);
    process.exit(1);
  });
