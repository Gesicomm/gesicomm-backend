'use strict';

/**
 * Script de migración — precio_minimo en producto_combos
 *
 * Agrega la columna precio_minimo (piso de venta configurado por el admin,
 * nunca se puede guardar precio_total por debajo de este valor).
 *
 * Ejecutar: node scripts/migrate-combo-precio-minimo.js
 */

const { sequelize } = require('../src/models');

async function migrar() {
  const qi = sequelize.getQueryInterface();

  const cols = await qi.describeTable('producto_combos');
  console.log('Columnas existentes:', Object.keys(cols).join(', '));

  if (!cols.precio_minimo) {
    await sequelize.query(`
      ALTER TABLE producto_combos
      ADD COLUMN precio_minimo DECIMAL(12, 2) NULL
    `);
    console.log('✓ precio_minimo: columna agregada.');
  } else {
    console.log('precio_minimo ya existe, nada que hacer.');
  }

  console.log('🎉 Migración completada.');
  process.exit(0);
}

migrar().catch(err => {
  console.error('❌ Error durante la migración:', err);
  process.exit(1);
});
