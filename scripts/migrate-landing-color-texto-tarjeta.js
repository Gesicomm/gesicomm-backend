'use strict';

/**
 * Script de migración — Override de color de texto y de tarjetas por landing.
 *
 * "landings":
 *   - color_texto    VARCHAR(7) NULL — override; null = hereda el default de tema_modo
 *   - color_tarjeta  VARCHAR(7) NULL — override; null = hereda el default de tema_modo
 *
 * Idempotente. Ejecutar: node scripts/migrate-landing-color-texto-tarjeta.js
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
    ['color_texto', { type: DataTypes.STRING(7), allowNull: true }],
    ['color_tarjeta', { type: DataTypes.STRING(7), allowNull: true }],
  ]);

  console.log('\nMigración completada.');
}

migrar()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error durante la migración:', err.message);
    process.exit(1);
  });
