'use strict';

/**
 * Script de migración — checkout público en la landing.
 *
 * Agrega:
 *   - envios.ruc                          VARCHAR(20) NULL
 *   - envios.stock_descontado             BOOLEAN NOT NULL DEFAULT false
 *   - landings.checkout_redirigir_whatsapp BOOLEAN NOT NULL DEFAULT true
 *
 * Mismo patrón que migrate-landing-banner.js / migrate-landing-contenido.js:
 * idempotente (columna por columna, se omite si ya existe), una sola
 * transacción. No usa sequelize.sync({alter:true}) — ver comentario en
 * migrate-landing-contenido.js sobre por qué.
 *
 * Ejecutar: node scripts/migrate-checkout-envio.js
 */

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../src/models');

async function migrar() {
  const qi = sequelize.getQueryInterface();
  const t = await sequelize.transaction();

  try {
    const columnasEnvios = await qi.describeTable('envios');
    if (!columnasEnvios.ruc) {
      await qi.addColumn('envios', 'ruc', { type: DataTypes.STRING(20), allowNull: true }, { transaction: t });
      console.log('  ✓ "envios.ruc" agregada.');
    } else {
      console.log('  "envios.ruc" ya existe, se omite.');
    }
    if (!columnasEnvios.stock_descontado) {
      await qi.addColumn('envios', 'stock_descontado', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, { transaction: t });
      console.log('  ✓ "envios.stock_descontado" agregada.');
    } else {
      console.log('  "envios.stock_descontado" ya existe, se omite.');
    }

    const columnasLanding = await qi.describeTable('landings');
    if (!columnasLanding.checkout_redirigir_whatsapp) {
      await qi.addColumn('landings', 'checkout_redirigir_whatsapp', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, { transaction: t });
      console.log('  ✓ "landings.checkout_redirigir_whatsapp" agregada.');
    } else {
      console.log('  "landings.checkout_redirigir_whatsapp" ya existe, se omite.');
    }

    await t.commit();
    console.log('\nMigración completada.');
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

migrar()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error durante la migración:', err.message);
    process.exit(1);
  });
