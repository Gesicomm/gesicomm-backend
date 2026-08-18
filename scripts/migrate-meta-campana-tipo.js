'use strict';

/**
 * Migración única (posterior a migrate-meta-reportes.js): agrega la
 * columna `tipo` (whatsapp/web) a `meta_campanas_internas`.
 *
 * Surgió porque el wizard de creación ahora pide elegir el canal a mano
 * (todavía no existe la campaña en Meta, así que no hay `objective` del
 * que derivarlo como sí hace la tabla "en vivo"). Filas existentes (si
 * las hubiera) quedan en 'web' por default — coincide con el default de
 * la columna, no hace falta backfill explícito.
 *
 * DDL puntual vía QueryInterface, idempotente (no rompe si ya se corrió).
 * No usa sequelize.sync({alter:true}) global.
 *
 * Ejecutar con:
 *   node scripts/migrate-meta-campana-tipo.js
 */

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../src/models');

async function migrar() {
  const qi = sequelize.getQueryInterface();
  try {
    await sequelize.authenticate();

    const columnas = await qi.describeTable('meta_campanas_internas');
    if (columnas.tipo) {
      console.log('"meta_campanas_internas.tipo" ya existe, no se hace nada.');
      return;
    }

    await qi.addColumn('meta_campanas_internas', 'tipo', {
      type: DataTypes.ENUM('whatsapp', 'web'),
      allowNull: false,
      defaultValue: 'web',
    });

    console.log('✓ "meta_campanas_internas.tipo" agregada (default \'web\').');
  } catch (err) {
    console.error('Error durante la migración:', err.message);
    throw err;
  }
}

migrar()
  .then(() => { process.exit(0); })
  .catch(() => { process.exit(1); });
