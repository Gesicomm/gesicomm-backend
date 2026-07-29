'use strict';

/**
 * Script de migración — Módulo Combos v2
 *
 * Agrega al schema existente:
 * - ProductoCombo: estado ENUM, descripcion, fecha_inicio, fecha_fin, snapshot_*
 * - ProductoComboItem: descuento_porcentaje, orden, snapshot_*
 * - ComboConfiguracion: nueva tabla
 *
 * Migra datos: activo=true → ACTIVO, activo=false → INACTIVO
 *
 * Ejecutar: node scripts/migrate-combos-v2.js
 */

const { sequelize, ComboConfiguracion } = require('../src/models');
const { DataTypes, QueryTypes } = require('sequelize');

async function migrar() {
  const qi = sequelize.getQueryInterface();

  // ── ProductoCombo ────────────────────────────────────────────────────────
  console.log('\n[1/3] Migrando producto_combos...');
  const comboCols = await qi.describeTable('producto_combos');
  console.log('  Columnas existentes:', Object.keys(comboCols).join(', '));

  if (!comboCols.estado) {
    await sequelize.query(`
      ALTER TABLE producto_combos 
      ADD COLUMN estado VARCHAR(20) NOT NULL DEFAULT 'BORRADOR'
    `);
    await sequelize.query(`
      UPDATE producto_combos 
      SET estado = CASE WHEN activo = true THEN 'ACTIVO' ELSE 'INACTIVO' END
    `);
    console.log('  ✓ estado: columna agregada y datos migrados');
  } else {
    console.log('  estado ya existe');
  }

  if (!comboCols.descripcion) {
    await qi.addColumn('producto_combos', 'descripcion', {
      type: DataTypes.STRING(500),
      allowNull: true,
    });
    console.log('  ✓ descripcion agregada');
  } else { console.log('  descripcion ya existe'); }

  const fechaCols = ['fecha_inicio', 'fecha_fin'];
  for (const col of fechaCols) {
    if (!comboCols[col]) {
      await qi.addColumn('producto_combos', col, { type: DataTypes.DATE, allowNull: true });
      console.log(`  ✓ ${col} agregada`);
    } else { console.log(`  ${col} ya existe`); }
  }

  const snapshotComboCols = {
    snapshot_cpa_porcentaje:    { type: DataTypes.DECIMAL(5, 2), allowNull: true },
    snapshot_costo_envio:       { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    snapshot_costo_confirmacion:{ type: DataTypes.DECIMAL(12, 2), allowNull: true },
    snapshot_costo_empaque:     { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    snapshot_precio_original:   { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    snapshot_precio_final:      { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    snapshot_costo_total:       { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    snapshot_utilidad:          { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    snapshot_margen:            { type: DataTypes.DECIMAL(8, 4), allowNull: true },
  };

  for (const [col, opts] of Object.entries(snapshotComboCols)) {
    if (!comboCols[col]) {
      await qi.addColumn('producto_combos', col, opts);
      console.log(`  ✓ ${col} agregada`);
    } else { console.log(`  ${col} ya existe`); }
  }

  // ── ProductoComboItem ────────────────────────────────────────────────────
  console.log('\n[2/3] Migrando producto_combo_items...');
  const itemCols = await qi.describeTable('producto_combo_items');
  console.log('  Columnas existentes:', Object.keys(itemCols).join(', '));

  if (!itemCols.descuento_porcentaje) {
    await qi.addColumn('producto_combo_items', 'descuento_porcentaje', {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0,
    });
    console.log('  ✓ descuento_porcentaje agregada');
  } else { console.log('  descuento_porcentaje ya existe'); }

  if (!itemCols.orden) {
    await qi.addColumn('producto_combo_items', 'orden', {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    console.log('  ✓ orden agregada');
  } else { console.log('  orden ya existe'); }

  const snapshotItemCols = {
    snapshot_costo:        { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    snapshot_precio_base:  { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    snapshot_precio_final: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
  };

  for (const [col, opts] of Object.entries(snapshotItemCols)) {
    if (!itemCols[col]) {
      await qi.addColumn('producto_combo_items', col, opts);
      console.log(`  ✓ ${col} agregada`);
    } else { console.log(`  ${col} ya existe`); }
  }

  // ── ComboConfiguracion ───────────────────────────────────────────────────
  console.log('\n[3/3] Sincronizando combo_configuraciones...');
  await ComboConfiguracion.sync({ force: false });
  console.log('  ✓ Tabla combo_configuraciones sincronizada');

  console.log('\n=== MIGRACIÓN COMPLETADA EXITOSAMENTE ===\n');
  process.exit(0);
}

migrar().catch(err => {
  console.error('\nERROR EN MIGRACIÓN:', err.message);
  console.error(err.stack);
  process.exit(1);
});
