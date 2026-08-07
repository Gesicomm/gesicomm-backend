'use strict';

/**
 * Script de migración — ABM de Métodos de Pago (con % de comisión) y
 * facturación por pedido.
 *
 * Crea:
 *   - metodos_pago (tabla nueva, por usuario)
 * Agrega a "envios":
 *   - quiere_factura          BOOLEAN NOT NULL DEFAULT false
 *   - razon_social            VARCHAR(255) NULL
 *   - ruc                     VARCHAR(20) NULL (ya existía en el modelo pero
 *                             nunca se había migrado a la tabla real)
 *   - nro_comprobante         VARCHAR(50) NULL
 *   - metodo_pago_id          INTEGER NULL (sin FK real — ver nota abajo)
 *   - comision_pct_aplicada   DECIMAL(5,2) NOT NULL DEFAULT 0
 * Índice único parcial (usuario_id, nro_comprobante) WHERE nro_comprobante
 * IS NOT NULL — permite dejarlo vacío pero nunca duplicado dentro del mismo
 * usuario.
 *
 * Sin FK real en metodo_pago_id, a propósito: ninguna tabla de este proyecto
 * usa FK a nivel Postgres (ver nota en migrate-landing-contenido.js) — el
 * aislamiento/validación se hace en la capa de controladores.
 *
 * No usa sequelize.sync({alter:true}) global — mismo motivo que
 * migrate-landing-contenido.js / migrate-tienda.js. DDL puntual vía
 * QueryInterface, dentro de UNA transacción (todo o nada).
 *
 * Idempotente: si las tablas/columnas/índices ya existen, se omiten.
 *
 * Rollback manual si hiciera falta (no se corre acá):
 *   DROP INDEX IF EXISTS envios_usuario_comprobante_unique;
 *   ALTER TABLE envios DROP COLUMN IF EXISTS quiere_factura, DROP COLUMN IF EXISTS razon_social,
 *     DROP COLUMN IF EXISTS nro_comprobante, DROP COLUMN IF EXISTS metodo_pago_id,
 *     DROP COLUMN IF EXISTS comision_pct_aplicada;
 *   DROP TABLE IF EXISTS metodos_pago;
 *
 * Ejecutar: node scripts/migrar-metodos-pago-y-factura.js
 */

require('dotenv').config();
const { DataTypes, Op } = require('sequelize');
const { sequelize } = require('../src/models');

async function migrar() {
  const qi = sequelize.getQueryInterface();
  const t = await sequelize.transaction();

  try {
    const tablas = await qi.showAllTables();

    if (!tablas.includes('metodos_pago')) {
      await qi.createTable('metodos_pago', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        usuario_id: { type: DataTypes.INTEGER, allowNull: false },
        nombre: { type: DataTypes.STRING(100), allowNull: false },
        comision_porcentaje: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
        es_anticipado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false },
      }, { transaction: t });
      await qi.addIndex('metodos_pago', ['usuario_id'], { transaction: t });
      console.log('  ✓ tabla "metodos_pago" creada.');
    } else {
      console.log('  "metodos_pago" ya existe, se omite.');
    }

    const columnasEnvios = await qi.describeTable('envios');

    if (!columnasEnvios.quiere_factura) {
      await qi.addColumn('envios', 'quiere_factura', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, { transaction: t });
      console.log('  ✓ "envios.quiere_factura" agregada.');
    } else {
      console.log('  "envios.quiere_factura" ya existe, se omite.');
    }

    if (!columnasEnvios.razon_social) {
      await qi.addColumn('envios', 'razon_social', { type: DataTypes.STRING(255), allowNull: true }, { transaction: t });
      console.log('  ✓ "envios.razon_social" agregada.');
    } else {
      console.log('  "envios.razon_social" ya existe, se omite.');
    }

    if (!columnasEnvios.ruc) {
      await qi.addColumn('envios', 'ruc', { type: DataTypes.STRING(20), allowNull: true }, { transaction: t });
      console.log('  ✓ "envios.ruc" agregada.');
    } else {
      console.log('  "envios.ruc" ya existe, se omite.');
    }

    if (!columnasEnvios.nro_comprobante) {
      await qi.addColumn('envios', 'nro_comprobante', { type: DataTypes.STRING(50), allowNull: true }, { transaction: t });
      console.log('  ✓ "envios.nro_comprobante" agregada.');
    } else {
      console.log('  "envios.nro_comprobante" ya existe, se omite.');
    }

    if (!columnasEnvios.metodo_pago_id) {
      await qi.addColumn('envios', 'metodo_pago_id', { type: DataTypes.INTEGER, allowNull: true }, { transaction: t });
      console.log('  ✓ "envios.metodo_pago_id" agregada.');
    } else {
      console.log('  "envios.metodo_pago_id" ya existe, se omite.');
    }

    if (!columnasEnvios.comision_pct_aplicada) {
      await qi.addColumn('envios', 'comision_pct_aplicada', { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 }, { transaction: t });
      console.log('  ✓ "envios.comision_pct_aplicada" agregada.');
    } else {
      console.log('  "envios.comision_pct_aplicada" ya existe, se omite.');
    }

    const indices = await qi.showIndex('envios', { transaction: t });
    const yaExisteIndice = indices.some(i => i.name === 'envios_usuario_comprobante_unique');
    if (!yaExisteIndice) {
      await qi.addIndex('envios', ['usuario_id', 'nro_comprobante'], {
        name: 'envios_usuario_comprobante_unique',
        unique: true,
        where: { nro_comprobante: { [Op.ne]: null } },
        transaction: t,
      });
      console.log('  ✓ índice único parcial "envios_usuario_comprobante_unique" creado.');
    } else {
      console.log('  índice "envios_usuario_comprobante_unique" ya existe, se omite.');
    }

    await t.commit();
    console.log('\nMigración completada.');
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

module.exports = { migrarMetodosPagoYFactura: migrar };

if (require.main === module) {
  migrar()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Error durante la migración:', err.message);
      process.exit(1);
    });
}
