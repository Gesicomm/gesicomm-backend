'use strict';

/**
 * Script de migración — Ofertas comerciales (pack/combo × normal/order_bump/upsell).
 *
 * Crea tres tablas nuevas:
 *   - ofertas_producto      (Oferta.js)
 *   - oferta_componentes    (OfertaComponente.js — receta de stock)
 *   - envio_item_componentes (EnvioItemComponente.js — snapshot inmutable
 *     de qué se descontó del stock al confirmar un pedido)
 * Y agrega a "envio_items":
 *   - oferta_id       INTEGER NULL
 *   - oferta_codigo   VARCHAR(50) NULL  (snapshot, no se recalcula después)
 *   - oferta_nombre   VARCHAR(150) NULL (snapshot, no se recalcula después)
 *
 * Sin FK real a nivel Postgres, a propósito: ninguna tabla de este proyecto
 * usa FK real (ver nota en migrate-landing-contenido.js) — el aislamiento/
 * validación se hace en la capa de controladores/servicios.
 *
 * No usa sequelize.sync({alter:true}) global — mismo motivo que
 * migrate-landing-contenido.js / migrate-tienda.js. DDL puntual vía
 * QueryInterface, dentro de UNA transacción (todo o nada).
 *
 * Idempotente: si las tablas/columnas ya existen, se omiten — se puede
 * correr más de una vez sin romper nada.
 *
 * Rollback manual si hiciera falta (no se corre acá):
 *   ALTER TABLE envio_items DROP COLUMN IF EXISTS oferta_id, DROP COLUMN IF EXISTS oferta_codigo, DROP COLUMN IF EXISTS oferta_nombre;
 *   DROP TABLE IF EXISTS envio_item_componentes;
 *   DROP TABLE IF EXISTS oferta_componentes;
 *   DROP TABLE IF EXISTS ofertas_producto;
 *   DROP TYPE IF EXISTS "enum_ofertas_producto_tipo_contenido";
 *   DROP TYPE IF EXISTS "enum_ofertas_producto_estrategia";
 *
 * Ejecutar: node scripts/migrar-ofertas.js
 */

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../src/models');

async function migrar() {
  const qi = sequelize.getQueryInterface();
  const t = await sequelize.transaction();

  try {
    const tablas = await qi.showAllTables();

    if (!tablas.includes('ofertas_producto')) {
      await qi.createTable('ofertas_producto', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        inquilino_id: { type: DataTypes.INTEGER, allowNull: false },
        producto_ancla_id: { type: DataTypes.INTEGER, allowNull: false },
        codigo: { type: DataTypes.STRING(50), allowNull: false },
        nombre: { type: DataTypes.STRING(150), allowNull: false },
        tipo_contenido: { type: DataTypes.ENUM('pack', 'combo'), allowNull: false, defaultValue: 'pack' },
        estrategia: { type: DataTypes.ENUM('normal', 'order_bump', 'upsell'), allowNull: false, defaultValue: 'normal' },
        precio: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        descripcion: { type: DataTypes.TEXT, allowNull: true },
        activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false },
      }, { transaction: t });
      await qi.addIndex('ofertas_producto', ['inquilino_id'], { transaction: t });
      await qi.addIndex('ofertas_producto', ['producto_ancla_id'], { transaction: t });
      await qi.addIndex('ofertas_producto', ['inquilino_id', 'codigo'], { unique: true, name: 'ofertas_producto_inquilino_codigo_unique', transaction: t });
      console.log('  ✓ tabla "ofertas_producto" creada.');
    } else {
      console.log('  "ofertas_producto" ya existe, se omite.');
    }

    if (!tablas.includes('oferta_componentes')) {
      await qi.createTable('oferta_componentes', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        oferta_id: { type: DataTypes.INTEGER, allowNull: false },
        producto_id: { type: DataTypes.INTEGER, allowNull: false },
        cantidad: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false },
      }, { transaction: t });
      await qi.addIndex('oferta_componentes', ['oferta_id'], { transaction: t });
      await qi.addIndex('oferta_componentes', ['producto_id'], { transaction: t });
      await qi.addIndex('oferta_componentes', ['oferta_id', 'producto_id'], { unique: true, name: 'oferta_componentes_oferta_producto_unique', transaction: t });
      console.log('  ✓ tabla "oferta_componentes" creada.');
    } else {
      console.log('  "oferta_componentes" ya existe, se omite.');
    }

    if (!tablas.includes('envio_item_componentes')) {
      await qi.createTable('envio_item_componentes', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        envio_item_id: { type: DataTypes.INTEGER, allowNull: false },
        producto_id: { type: DataTypes.INTEGER, allowNull: false },
        cantidad: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
        costo_unitario: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false },
      }, { transaction: t });
      await qi.addIndex('envio_item_componentes', ['envio_item_id'], { transaction: t });
      await qi.addIndex('envio_item_componentes', ['producto_id'], { transaction: t });
      console.log('  ✓ tabla "envio_item_componentes" creada.');
    } else {
      console.log('  "envio_item_componentes" ya existe, se omite.');
    }

    const columnasEnvioItems = await qi.describeTable('envio_items');

    if (!columnasEnvioItems.oferta_id) {
      await qi.addColumn('envio_items', 'oferta_id', { type: DataTypes.INTEGER, allowNull: true }, { transaction: t });
      console.log('  ✓ "envio_items.oferta_id" agregada.');
    } else {
      console.log('  "envio_items.oferta_id" ya existe, se omite.');
    }

    if (!columnasEnvioItems.oferta_codigo) {
      await qi.addColumn('envio_items', 'oferta_codigo', { type: DataTypes.STRING(50), allowNull: true }, { transaction: t });
      console.log('  ✓ "envio_items.oferta_codigo" agregada.');
    } else {
      console.log('  "envio_items.oferta_codigo" ya existe, se omite.');
    }

    if (!columnasEnvioItems.oferta_nombre) {
      await qi.addColumn('envio_items', 'oferta_nombre', { type: DataTypes.STRING(150), allowNull: true }, { transaction: t });
      console.log('  ✓ "envio_items.oferta_nombre" agregada.');
    } else {
      console.log('  "envio_items.oferta_nombre" ya existe, se omite.');
    }

    await t.commit();
    console.log('\nMigración completada.');
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

module.exports = { migrarOfertas: migrar };

if (require.main === module) {
  migrar()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Error durante la migración:', err.message);
      process.exit(1);
    });
}
