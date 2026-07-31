'use strict';

/**
 * Script de migración — plan en usuarios
 *
 * Agrega la columna plan (ENUM 'free'/'pago', nullable — null hasta que el
 * usuario complete el onboarding). Va a nivel de cuenta, no de tienda: hoy
 * un usuario tiene una sola tienda, pero el plan es un concepto de cuenta
 * pensando en soportar varias tiendas por usuario más adelante. Sin cobro
 * integrado — "pago" solo marca la intención por ahora.
 *
 * Ejecutar: node scripts/agregar-plan-usuario.js
 */

const { sequelize } = require('../src/models');
const { DataTypes } = require('sequelize');

async function migrar() {
  const qi = sequelize.getQueryInterface();

  const cols = await qi.describeTable('usuarios');
  console.log('Columnas existentes:', Object.keys(cols).join(', '));

  if (!cols.plan) {
    await qi.addColumn('usuarios', 'plan', {
      type: DataTypes.ENUM('free', 'pago'),
      allowNull: true,
    });
    console.log('✓ plan: columna agregada.');
  } else {
    console.log('plan ya existe, nada que hacer.');
  }

  console.log('🎉 Migración completada.');
  process.exit(0);
}

migrar().catch(err => {
  console.error('❌ Error durante la migración:', err);
  process.exit(1);
});
