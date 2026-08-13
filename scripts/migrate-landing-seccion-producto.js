'use strict';

/**
 * Script de migración — Diseño de página propio por producto.
 *
 * Agrega a "landing_secciones":
 *   - producto_id  INTEGER NULL  (sin FK a nivel Postgres — misma
 *     convención que landing_id en esta misma tabla: aislamiento en la
 *     capa de queries, no en el schema).
 *   - índice en (producto_id) — para el filtro que hace
 *     LandingService.obtenerProductoPublico() al resolver si un producto
 *     tiene secciones propias.
 *
 * Filas con producto_id NULL = comportamiento actual sin cambios (la
 * plantilla "Vista de Producto" compartida por toda la tienda). Filas con
 * producto_id seteado = secciones exclusivas de ESE producto — el service
 * las prioriza sobre las compartidas cuando existen. No hace falta
 * backfill: ninguna fila existente debe llevar producto_id.
 *
 * Sin sync_db.js ni sequelize.sync({alter:true}) global. DDL puntual vía
 * QueryInterface, dentro de UNA transacción. Idempotente.
 *
 * Rollback manual si hiciera falta (no se corre acá):
 *   DROP INDEX IF EXISTS landing_secciones_producto_id;
 *   ALTER TABLE landing_secciones DROP COLUMN IF EXISTS producto_id;
 *
 * Ejecutar: node scripts/migrate-landing-seccion-producto.js
 */

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../src/models');

async function migrar() {
  const qi = sequelize.getQueryInterface();
  const t = await sequelize.transaction();

  try {
    const columnas = await qi.describeTable('landing_secciones');

    if (!columnas.producto_id) {
      await qi.addColumn('landing_secciones', 'producto_id', {
        type: DataTypes.INTEGER,
        allowNull: true,
      }, { transaction: t });
      console.log('  ✓ "landing_secciones.producto_id" agregada.');
    } else {
      console.log('  "landing_secciones.producto_id" ya existe, se omite.');
    }

    console.log('  Consultando índices existentes...');
    const indices = await qi.showIndex('landing_secciones', { transaction: t });
    const yaExisteIndice = indices.some(idx => idx.fields?.length === 1
      && idx.fields.some(f => f.attribute === 'producto_id'));

    if (!yaExisteIndice) {
      await qi.addIndex('landing_secciones', ['producto_id'], {
        name: 'landing_secciones_producto_id',
        transaction: t,
      });
      console.log('  ✓ índice (producto_id) creado.');
    } else {
      console.log('  índice (producto_id) ya existe, se omite.');
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
