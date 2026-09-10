'use strict';

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../src/models');

const TIMESTAMPS = {
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
};

async function existeTabla(qi, nombre, t) {
  const tablas = await qi.showAllTables({ transaction: t });
  return tablas.map(tab => (typeof tab === 'string' ? tab : tab.tableName)).includes(nombre);
}

async function existeColumna(qi, tabla, columna, t) {
  const desc = await qi.describeTable(tabla, { transaction: t });
  return !!desc[columna];
}

async function main() {
  const qi = sequelize.getQueryInterface();
  const t = await sequelize.transaction();

  try {
    if (!(await existeTabla(qi, 'afiliados', t))) {
      await qi.createTable('afiliados', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        nombre: { type: DataTypes.STRING(150), allowNull: false },
        email: { type: DataTypes.STRING(255), allowNull: true },
        codigo: { type: DataTypes.STRING(80), allowNull: false, unique: true },
        comision_pct: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 40 },
        estado: { type: DataTypes.ENUM('activo', 'pausado'), allowNull: false, defaultValue: 'activo' },
        notas: { type: DataTypes.TEXT, allowNull: true },
        ...TIMESTAMPS,
      }, { transaction: t });
    }

    if (!(await existeColumna(qi, 'suscripciones', 'afiliado_id', t))) {
      await qi.addColumn('suscripciones', 'afiliado_id', {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'afiliados', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      }, { transaction: t });
      await qi.addIndex('suscripciones', ['afiliado_id'], { transaction: t });
    }

    if (!(await existeColumna(qi, 'suscripciones', 'afiliado_codigo', t))) {
      await qi.addColumn('suscripciones', 'afiliado_codigo', {
        type: DataTypes.STRING(80),
        allowNull: true,
      }, { transaction: t });
    }

    if (!(await existeTabla(qi, 'afiliado_clicks', t))) {
      await qi.createTable('afiliado_clicks', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        afiliado_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'afiliados', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        codigo: { type: DataTypes.STRING(80), allowNull: false },
        landing_url: { type: DataTypes.TEXT, allowNull: true },
        ip_hash: { type: DataTypes.STRING(64), allowNull: true },
        user_agent: { type: DataTypes.TEXT, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      }, { transaction: t });
      await qi.addIndex('afiliado_clicks', ['afiliado_id'], { transaction: t });
      await qi.addIndex('afiliado_clicks', ['codigo'], { transaction: t });
    }

    if (!(await existeTabla(qi, 'afiliado_comisiones', t))) {
      await qi.createTable('afiliado_comisiones', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        afiliado_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'afiliados', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        suscripcion_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'suscripciones', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        pago_suscripcion_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          unique: true,
          references: { model: 'pagos_suscripcion', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        monto_base: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        comision_pct: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 40 },
        monto_comision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        estado: {
          type: DataTypes.ENUM('pendiente', 'aprobada', 'pagada', 'anulada'),
          allowNull: false,
          defaultValue: 'pendiente',
        },
        notas: { type: DataTypes.TEXT, allowNull: true },
        ...TIMESTAMPS,
      }, { transaction: t });
      await qi.addIndex('afiliado_comisiones', ['afiliado_id'], { transaction: t });
      await qi.addIndex('afiliado_comisiones', ['suscripcion_id'], { transaction: t });
      await qi.addIndex('afiliado_comisiones', ['estado'], { transaction: t });
    }

    await t.commit();
    console.log('✓ Módulo de afiliados migrado.');
  } catch (err) {
    await t.rollback();
    console.error('✗ Falló la migración de afiliados:', err);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

main();
