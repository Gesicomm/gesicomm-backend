'use strict';

/**
 * Migración única: crea el modelo de planes y suscripciones de Gesicomm
 * (lo que Gesicomm le cobra a sus clientes, no lo que un comercio le cobra
 * a los suyos).
 *
 * Crea tres tablas:
 *   - planes             catálogo de planes contratables
 *   - suscripciones      quién contrató qué, con usuario_id NULLABLE porque
 *                        se paga ANTES de registrarse (ver Suscripcion.js)
 *   - pagos_suscripcion  cada intento de cobro contra PagoPar
 *
 * Y siembra los planes actuales tomándolos de PLANES_DEFAULT del frontend
 * (gesicomm-frontend/src/lib/planesCatalogo.js). OJO: esos precios y
 * features son PLACEHOLDERS sin validar comercialmente — revisalos antes de
 * correr esto en producción.
 *
 * Sigue la convención del proyecto: DDL puntual vía QueryInterface, todo en
 * UNA transacción (Postgres es transaccional para DDL), sin
 * sequelize.sync({alter:true}) global — que ya causó un incidente acá.
 *
 * Es idempotente: si las tablas ya existen, no hace nada.
 *
 * Ejecutar con:
 *   node scripts/migrate-planes-suscripciones.js
 */

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../src/models');

// Espejo de PLANES_DEFAULT del frontend. Placeholders: reemplazar por los
// planes reales antes de usar esto de verdad.
const PLANES_SEMILLA = [
  {
    codigo: 'free',
    nombre: 'Free',
    precio: 0,
    equivale_plan: 'free',
    resumen: 'Para empezar a vender y probar la plataforma sin costo.',
    etiqueta: null,
    cta: 'Tu plan actual',
    destacado: false,
    orden: 1,
    features: [
      'Catálogo público con tu subdominio de Gesicomm',
      '1 landing publicada',
      'Pedidos por WhatsApp',
      'Hasta 30 productos',
    ],
  },
  {
    codigo: 'pro',
    nombre: 'Pro',
    precio: 250000,
    equivale_plan: 'pago',
    resumen: 'Para la tienda que ya vende todos los días y necesita medir.',
    etiqueta: 'El más elegido',
    cta: 'Pasar a Pro',
    destacado: true,
    orden: 2,
    features: [
      'Todo lo del plan Free',
      'Landings ilimitadas y embudos de venta',
      'Dominio propio con certificado',
      'Cobros online con pasarela',
      'Meta Pixel, CAPI, Google Analytics y TikTok',
      'Armador de combos con cálculo de rentabilidad',
    ],
  },
  {
    codigo: 'negocio',
    nombre: 'Negocio',
    precio: 450000,
    equivale_plan: 'pago',
    resumen: 'Para operaciones con equipo, catálogo grande y automatizaciones.',
    etiqueta: null,
    cta: 'Pasar a Negocio',
    destacado: false,
    orden: 3,
    features: [
      'Todo lo del plan Pro',
      'Productos y pedidos sin límite',
      'Automatizaciones y canales de venta',
      'Vitrina B2B para revendedores',
      'Reportes avanzados de ventas',
      'Soporte prioritario',
    ],
  },
];

const TIMESTAMPS = {
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
};

async function existeTabla(qi, nombre) {
  const tablas = await qi.showAllTables();
  return tablas.map(t => (typeof t === 'string' ? t : t.tableName)).includes(nombre);
}

async function existeColumna(qi, tabla, columna) {
  const descripcion = await qi.describeTable(tabla);
  return !!descripcion[columna];
}

async function asegurarColumnasSuscripciones(qi, transaction) {
  if (!(await existeTabla(qi, 'suscripciones'))) return false;

  let cambio = false;
  if (!(await existeColumna(qi, 'suscripciones', 'telefono'))) {
    console.log('→ Agregando columna "suscripciones.telefono"...');
    await qi.addColumn('suscripciones', 'telefono', {
      type: DataTypes.STRING(40),
      allowNull: true,
    }, { transaction });
    cambio = true;
  }

  if (!(await existeColumna(qi, 'suscripciones', 'documento'))) {
    console.log('→ Agregando columna "suscripciones.documento"...');
    await qi.addColumn('suscripciones', 'documento', {
      type: DataTypes.STRING(30),
      allowNull: true,
    }, { transaction });
    cambio = true;
  }

  return cambio;
}

async function main() {
  const qi = sequelize.getQueryInterface();
  const t = await sequelize.transaction();

  try {
    if (await existeTabla(qi, 'planes')) {
      const huboCambio = await asegurarColumnasSuscripciones(qi, t);
      if (!huboCambio) console.log('→ Las tablas de planes y suscripciones ya están al día.');
      await t.commit();
      return;
    }

    console.log('→ Creando tabla "planes"...');
    await qi.createTable('planes', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      codigo: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      nombre: { type: DataTypes.STRING(100), allowNull: false },
      resumen: { type: DataTypes.TEXT, allowNull: true },
      precio: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      periodicidad: { type: DataTypes.ENUM('mensual', 'anual', 'unico'), allowNull: false, defaultValue: 'mensual' },
      equivale_plan: { type: DataTypes.ENUM('free', 'pago'), allowNull: false, defaultValue: 'pago' },
      features: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
      etiqueta: { type: DataTypes.STRING(50), allowNull: true },
      cta: { type: DataTypes.STRING(80), allowNull: true },
      destacado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      ...TIMESTAMPS,
    }, { transaction: t });

    console.log('→ Creando tabla "suscripciones"...');
    await qi.createTable('suscripciones', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      plan_id: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: 'planes', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'RESTRICT',
      },
      // Nullable a propósito: se paga antes de existir el Usuario.
      usuario_id: {
        type: DataTypes.INTEGER, allowNull: true,
        references: { model: 'usuarios', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      email: { type: DataTypes.STRING(255), allowNull: false },
      nombre: { type: DataTypes.STRING(150), allowNull: true },
      telefono: { type: DataTypes.STRING(40), allowNull: true },
      documento: { type: DataTypes.STRING(30), allowNull: true },
      estado: {
        type: DataTypes.ENUM('pendiente_pago', 'activa', 'vencida', 'cancelada'),
        allowNull: false, defaultValue: 'pendiente_pago',
      },
      precio_pagado: { type: DataTypes.INTEGER, allowNull: false },
      periodo_inicio: { type: DataTypes.DATE, allowNull: true },
      periodo_fin: { type: DataTypes.DATE, allowNull: true },
      token_registro: { type: DataTypes.STRING(64), allowNull: true, unique: true },
      token_registro_expira: { type: DataTypes.DATE, allowNull: true },
      ...TIMESTAMPS,
    }, { transaction: t });

    await qi.addIndex('suscripciones', ['email'], { transaction: t });
    await qi.addIndex('suscripciones', ['usuario_id'], { transaction: t });
    await qi.addIndex('suscripciones', ['estado'], { transaction: t });

    console.log('→ Creando tabla "pagos_suscripcion"...');
    await qi.createTable('pagos_suscripcion', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      suscripcion_id: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: 'suscripciones', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      provider: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'pagopar' },
      referencia: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      hash_pedido: { type: DataTypes.STRING(255), allowNull: true },
      estado: { type: DataTypes.ENUM('PENDING', 'PAID', 'FAILED'), allowNull: false, defaultValue: 'PENDING' },
      monto: { type: DataTypes.INTEGER, allowNull: false },
      pagado_en: { type: DataTypes.DATE, allowNull: true },
      respuesta_pasarela: { type: DataTypes.JSON, allowNull: true },
      ...TIMESTAMPS,
    }, { transaction: t });

    await qi.addIndex('pagos_suscripcion', ['suscripcion_id'], { transaction: t });
    await qi.addIndex('pagos_suscripcion', ['hash_pedido'], { transaction: t });

    console.log('→ Sembrando planes (PLACEHOLDERS — revisar precios)...');
    const ahora = new Date();
    await qi.bulkInsert('planes', PLANES_SEMILLA.map(p => ({
      ...p,
      features: JSON.stringify(p.features),
      periodicidad: 'mensual',
      activo: true,
      created_at: ahora,
      updated_at: ahora,
    })), { transaction: t });

    await t.commit();
    console.log('\n✓ Listo. 3 tablas creadas y', PLANES_SEMILLA.length, 'planes sembrados.');
    console.log('  Recordá revisar los precios: son placeholders.');
  } catch (err) {
    await t.rollback();
    console.error('\n✗ Falló la migración, no quedó nada a medias:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

main();
