'use strict';

/**
 * Script de migración — Historial y trazabilidad del pedido (ver plan
 * Gestión de Pedidos sección 24).
 *
 * Crea la tabla:
 *   - envio_historial (envio_id, detalle, usuario_id, created_at)
 *
 * Log simple de movimientos por pedido — se consulta desde el detalle del
 * pedido, no ocupa espacio permanente en la tabla principal.
 *
 * Sin FK real, a propósito — ver nota en migrar-ofertas.js.
 * Idempotente: si la tabla ya existe, se omite.
 *
 * Ejecutar: node scripts/migrar-envio-historial.js
 */

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../src/models');

async function migrar() {
  const qi = sequelize.getQueryInterface();
  const t = await sequelize.transaction();

  try {
    const tablas = await qi.showAllTables();

    if (!tablas.includes('envio_historial')) {
      await qi.createTable('envio_historial', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        envio_id: { type: DataTypes.INTEGER, allowNull: false },
        detalle: { type: DataTypes.STRING(255), allowNull: false },
        usuario_id: { type: DataTypes.INTEGER, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false },
      }, { transaction: t });
      await qi.addIndex('envio_historial', ['envio_id'], { transaction: t });
      console.log('  ✓ tabla "envio_historial" creada.');
    } else {
      console.log('  "envio_historial" ya existe, se omite.');
    }

    await t.commit();
    console.log('\nMigración completada.');
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

module.exports = { migrarEnvioHistorial: migrar };

if (require.main === module) {
  migrar()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Error durante la migración:', err.message);
      process.exit(1);
    });
}
