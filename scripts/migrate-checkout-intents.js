'use strict';

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../src/models');

const TIMESTAMPS = {
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
};

async function existeTabla(qi, nombre, transaction) {
  const tablas = await qi.showAllTables({ transaction });
  return tablas.map(t => (typeof t === 'string' ? t : t.tableName)).includes(nombre);
}

async function columnas(qi, tabla, transaction) {
  if (!(await existeTabla(qi, tabla, transaction))) return {};
  return qi.describeTable(tabla, { transaction });
}

async function addColumnIfMissing(qi, tabla, columna, definicion, transaction) {
  const cols = await columnas(qi, tabla, transaction);
  if (cols[columna]) return false;
  await qi.addColumn(tabla, columna, definicion, { transaction });
  console.log(`  + ${tabla}.${columna}`);
  return true;
}

async function removeColumnIfExists(qi, tabla, columna, transaction) {
  const cols = await columnas(qi, tabla, transaction);
  if (!cols[columna]) return false;
  await qi.removeColumn(tabla, columna, { transaction });
  console.log(`  - ${tabla}.${columna}`);
  return true;
}

async function columnaEsUuid(qi, tabla, columna, transaction) {
  const cols = await columnas(qi, tabla, transaction);
  return /uuid/i.test(String(cols[columna]?.type || ''));
}

async function addIndexSafe(qi, tabla, campos, transaction, options = {}) {
  const normalizados = campos.map(String).sort().join(',');
  const indices = await qi.showIndex(tabla, { transaction });
  const yaExiste = indices.some((idx) => {
    const fields = (idx.fields || [])
      .map(f => String(f.attribute || f.name || f))
      .sort()
      .join(',');
    return fields === normalizados;
  });
  if (yaExiste) return false;

  await qi.addIndex(tabla, campos, { ...options, transaction });
  return true;
}

async function recrearCheckoutNumericoSiHaceFalta(qi, transaction) {
  const checkoutUuid = (await existeTabla(qi, 'checkout_intents', transaction))
    && await columnaEsUuid(qi, 'checkout_intents', 'id', transaction);
  const purchasesUuid = (await existeTabla(qi, 'subscription_purchases', transaction))
    && await columnaEsUuid(qi, 'subscription_purchases', 'id', transaction);

  if (!checkoutUuid && !purchasesUuid) return;

  console.log('→ Reemplazando checkout_intents/subscription_purchases UUID por IDs numéricos...');
  await removeColumnIfExists(qi, 'pagos_suscripcion', 'subscription_purchase_id', transaction);
  await removeColumnIfExists(qi, 'suscripciones', 'subscription_purchase_id', transaction);
  await removeColumnIfExists(qi, 'suscripciones', 'checkout_intent_id', transaction);

  if (await existeTabla(qi, 'subscription_purchases', transaction)) {
    await qi.dropTable('subscription_purchases', { transaction });
    console.log('  - subscription_purchases');
  }
  if (await existeTabla(qi, 'checkout_intents', transaction)) {
    await qi.dropTable('checkout_intents', { transaction });
    console.log('  - checkout_intents');
  }
}

async function asegurarColumnasPlanesYAfiliados(qi, transaction) {
  await addColumnIfMissing(qi, 'planes', 'moneda', { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'PYG' }, transaction);

  await addColumnIfMissing(qi, 'suscripciones', 'telefono', { type: DataTypes.STRING(40), allowNull: true }, transaction);
  await addColumnIfMissing(qi, 'suscripciones', 'documento', { type: DataTypes.STRING(30), allowNull: true }, transaction);

  if (!(await existeTabla(qi, 'afiliados', transaction))) return;

  await addColumnIfMissing(qi, 'afiliados', 'usuario_id', {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'usuarios', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  }, transaction);
  await addColumnIfMissing(qi, 'afiliados', 'telefono', { type: DataTypes.STRING(50), allowNull: true }, transaction);
  await addColumnIfMissing(qi, 'afiliados', 'metodo_pago', { type: DataTypes.STRING(50), allowNull: true }, transaction);
  await addColumnIfMissing(qi, 'afiliados', 'entidad_pago', { type: DataTypes.STRING(120), allowNull: true }, transaction);
  await addColumnIfMissing(qi, 'afiliados', 'titular_pago', { type: DataTypes.STRING(150), allowNull: true }, transaction);
  await addColumnIfMissing(qi, 'afiliados', 'documento_pago', { type: DataTypes.STRING(80), allowNull: true }, transaction);
  await addColumnIfMissing(qi, 'afiliados', 'cuenta_pago', { type: DataTypes.STRING(160), allowNull: true }, transaction);
  await addIndexSafe(qi, 'afiliados', ['usuario_id'], transaction, { unique: true });
}

async function main() {
  const qi = sequelize.getQueryInterface();
  const t = await sequelize.transaction();

  try {
    await asegurarColumnasPlanesYAfiliados(qi, t);
    await recrearCheckoutNumericoSiHaceFalta(qi, t);

    if (!(await existeTabla(qi, 'checkout_intents', t))) {
      console.log('→ Creando checkout_intents...');
      await qi.createTable('checkout_intents', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        token: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, allowNull: false, unique: true },
        plan_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'planes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
        plan_codigo: { type: DataTypes.STRING(50), allowNull: false },
        usuario_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'usuarios', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
        email: { type: DataTypes.STRING(255), allowNull: true },
        nombre: { type: DataTypes.STRING(150), allowNull: true },
        telefono: { type: DataTypes.STRING(40), allowNull: true },
        documento: { type: DataTypes.STRING(30), allowNull: true },
        authenticated: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        estado: { type: DataTypes.ENUM('active', 'expired', 'completed', 'abandoned'), allowNull: false, defaultValue: 'active' },
        affiliate_ref: { type: DataTypes.STRING(80), allowNull: true },
        affiliate_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'afiliados', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
        expires_at: { type: DataTypes.DATE, allowNull: false },
        completed_at: { type: DataTypes.DATE, allowNull: true },
        abandoned_at: { type: DataTypes.DATE, allowNull: true },
        metadata: { type: DataTypes.JSON, allowNull: true },
        ...TIMESTAMPS,
      }, { transaction: t });
      await addIndexSafe(qi, 'checkout_intents', ['token'], t, { unique: true });
      await addIndexSafe(qi, 'checkout_intents', ['email'], t);
      await addIndexSafe(qi, 'checkout_intents', ['usuario_id'], t);
      await addIndexSafe(qi, 'checkout_intents', ['estado'], t);
      await addIndexSafe(qi, 'checkout_intents', ['affiliate_id'], t);
      await addIndexSafe(qi, 'checkout_intents', ['expires_at'], t);
    }

    if (!(await existeTabla(qi, 'subscription_purchases', t))) {
      console.log('→ Creando subscription_purchases...');
      await qi.createTable('subscription_purchases', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        checkout_intent_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'checkout_intents', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
        suscripcion_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'suscripciones', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
        plan_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'planes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
        plan_codigo: { type: DataTypes.STRING(50), allowNull: false },
        usuario_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'usuarios', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
        email: { type: DataTypes.STRING(255), allowNull: false },
        nombre: { type: DataTypes.STRING(150), allowNull: false },
        telefono: { type: DataTypes.STRING(40), allowNull: true },
        documento: { type: DataTypes.STRING(30), allowNull: true },
        affiliate_ref: { type: DataTypes.STRING(80), allowNull: true },
        affiliate_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'afiliados', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
        monto: { type: DataTypes.INTEGER, allowNull: false },
        moneda: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'PYG' },
        estado: { type: DataTypes.ENUM('created', 'payment_started', 'paid', 'failed', 'cancelled'), allowNull: false, defaultValue: 'created' },
        payment_id: { type: DataTypes.INTEGER, allowNull: true },
        paid_at: { type: DataTypes.DATE, allowNull: true },
        metadata: { type: DataTypes.JSON, allowNull: true },
        ...TIMESTAMPS,
      }, { transaction: t });
      await addIndexSafe(qi, 'subscription_purchases', ['checkout_intent_id'], t);
      await addIndexSafe(qi, 'subscription_purchases', ['suscripcion_id'], t);
      await addIndexSafe(qi, 'subscription_purchases', ['payment_id'], t);
      await addIndexSafe(qi, 'subscription_purchases', ['usuario_id'], t);
      await addIndexSafe(qi, 'subscription_purchases', ['affiliate_id'], t);
      await addIndexSafe(qi, 'subscription_purchases', ['estado'], t);
    }

    await addColumnIfMissing(qi, 'suscripciones', 'checkout_intent_id', { type: DataTypes.INTEGER, allowNull: true, references: { model: 'checkout_intents', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' }, t);
    await addColumnIfMissing(qi, 'suscripciones', 'subscription_purchase_id', { type: DataTypes.INTEGER, allowNull: true, references: { model: 'subscription_purchases', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' }, t);
    await addColumnIfMissing(qi, 'pagos_suscripcion', 'subscription_purchase_id', { type: DataTypes.INTEGER, allowNull: true, references: { model: 'subscription_purchases', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' }, t);
    await addColumnIfMissing(qi, 'afiliado_comisiones', 'brevo_notificado_en', { type: DataTypes.DATE, allowNull: true }, t);
    await addColumnIfMissing(qi, 'afiliado_comisiones', 'brevo_notificacion_error', { type: DataTypes.TEXT, allowNull: true }, t);
    await addColumnIfMissing(qi, 'usuarios', 'affiliate_ref', { type: DataTypes.STRING(80), allowNull: true }, t);
    await addColumnIfMissing(qi, 'usuarios', 'affiliate_id', { type: DataTypes.INTEGER, allowNull: true, references: { model: 'afiliados', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' }, t);

    await addIndexSafe(qi, 'suscripciones', ['checkout_intent_id'], t);
    await addIndexSafe(qi, 'suscripciones', ['subscription_purchase_id'], t);
    await addIndexSafe(qi, 'pagos_suscripcion', ['subscription_purchase_id'], t);
    await addIndexSafe(qi, 'usuarios', ['affiliate_id'], t);

    await t.commit();
    console.log('✓ Checkout intents y purchases listos.');
  } catch (err) {
    await t.rollback();
    console.error('✗ Falló la migración:', err);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

main();
