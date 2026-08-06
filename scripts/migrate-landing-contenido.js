'use strict';

/**
 * Script de migración — Testimonios y FAQ por landing.
 *
 * Crea dos tablas nuevas ("testimonios", "faqs") y agrega a "landings" los
 * dos flags que activan cada sección en la página pública:
 *   - mostrar_testimonios  BOOLEAN NOT NULL DEFAULT false
 *   - mostrar_faq          BOOLEAN NOT NULL DEFAULT false
 *
 * Sin `references`/FK a nivel Postgres en landing_id, a propósito: ninguna
 * tabla de este proyecto usa FK real (ver landings.tienda_id,
 * landing_items.landing_id) — el aislamiento se hace en la capa de queries,
 * no en el schema. Se mantiene esa misma convención acá.
 *
 * No usa sequelize.sync({alter:true}) global — mismo motivo que
 * migrate-tienda.js: ya causó un incidente en este proyecto con una tabla
 * no relacionada (y sync_db.js en la raíz todavía tiene un DROP TABLE
 * residual de esa historia). Hace DDL puntual vía QueryInterface, dentro de
 * UNA transacción (todo o nada).
 *
 * Idempotente: si las tablas/columnas ya existen, se omiten — se puede
 * correr más de una vez sin romper nada.
 *
 * Rollback manual si hiciera falta (no se corre acá):
 *   DROP TABLE IF EXISTS testimonios;
 *   DROP TABLE IF EXISTS faqs;
 *   ALTER TABLE landings DROP COLUMN IF EXISTS mostrar_testimonios, DROP COLUMN IF EXISTS mostrar_faq;
 *
 * Ejecutar: node scripts/migrate-landing-contenido.js
 */

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../src/models');

async function migrar() {
  const qi = sequelize.getQueryInterface();
  const t = await sequelize.transaction();

  try {
    const tablas = await qi.showAllTables();

    if (!tablas.includes('testimonios')) {
      await qi.createTable('testimonios', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        landing_id: { type: DataTypes.INTEGER, allowNull: false },
        nombre: { type: DataTypes.STRING(150), allowNull: false },
        foto: { type: DataTypes.STRING(255), allowNull: true },
        calificacion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },
        comentario: { type: DataTypes.TEXT, allowNull: false },
        orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false },
      }, { transaction: t });
      await qi.addIndex('testimonios', ['landing_id'], { transaction: t });
      console.log('  ✓ tabla "testimonios" creada.');
    } else {
      console.log('  "testimonios" ya existe, se omite.');
    }

    if (!tablas.includes('faqs')) {
      await qi.createTable('faqs', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        landing_id: { type: DataTypes.INTEGER, allowNull: false },
        pregunta: { type: DataTypes.STRING(300), allowNull: false },
        respuesta: { type: DataTypes.TEXT, allowNull: false },
        orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false },
      }, { transaction: t });
      await qi.addIndex('faqs', ['landing_id'], { transaction: t });
      console.log('  ✓ tabla "faqs" creada.');
    } else {
      console.log('  "faqs" ya existe, se omite.');
    }

    const columnasLanding = await qi.describeTable('landings');
    if (!columnasLanding.mostrar_testimonios) {
      await qi.addColumn('landings', 'mostrar_testimonios', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, { transaction: t });
      console.log('  ✓ "landings.mostrar_testimonios" agregada.');
    } else {
      console.log('  "landings.mostrar_testimonios" ya existe, se omite.');
    }
    if (!columnasLanding.mostrar_faq) {
      await qi.addColumn('landings', 'mostrar_faq', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, { transaction: t });
      console.log('  ✓ "landings.mostrar_faq" agregada.');
    } else {
      console.log('  "landings.mostrar_faq" ya existe, se omite.');
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
