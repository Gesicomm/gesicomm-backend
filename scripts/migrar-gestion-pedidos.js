'use strict';

/**
 * Script de migración — Gestión de Pedidos (bandeja operativa + rendición).
 *
 * FASE A — Estructura (aditiva, no destructiva):
 *   envios:
 *     - estado_financiero      ENUM('pendiente_liquidacion','liquidado') NOT NULL DEFAULT 'pendiente_liquidacion'
 *     - fecha_reprogramada     DATEONLY NULL
 *     - motivo_reprogramacion  VARCHAR(255) NULL
 *     - stock_despachado       BOOLEAN NOT NULL DEFAULT false
 *     - stock_liberado         BOOLEAN NOT NULL DEFAULT false
 *     - cargo_perdida_courier  INTEGER NULL
 *   envio_item_componentes:
 *     - cantidad_devuelta_vendible  INTEGER NOT NULL DEFAULT 0
 *     - cantidad_devuelta_danada    INTEGER NOT NULL DEFAULT 0
 *     - cantidad_perdida            INTEGER NOT NULL DEFAULT 0
 *   productos:
 *     - cantidad_reservada  INTEGER NOT NULL DEFAULT 0
 *     - cantidad_transito   INTEGER NOT NULL DEFAULT 0
 *   metodos_pago:
 *     - custodia_cobro  ENUM('negocio','courier') NOT NULL DEFAULT 'negocio'
 *   tablas nuevas:
 *     - liquidaciones       (Liquidacion.js)
 *     - liquidacion_envios  (LiquidacionEnvio.js)
 *
 * FASE B — Datos (reescritura de estados legacy, NO se ejecuta salvo
 * confirmación explícita del usuario en el momento de correr el script —
 * ver migrarDatosLegacy más abajo):
 *   - 'En camino' / 'En Tránsito'  → 'Despachado'
 *   - 'Reagendado'                 → 'Reprogramado'
 *   - 'Rendido'                    → 'Entregado' + estado_financiero='liquidado'
 *
 * Sin FK real en ninguna columna nueva, a propósito — ver nota en
 * migrar-ofertas.js / migrate-landing-contenido.js: ninguna tabla de este
 * proyecto usa FK real a nivel Postgres, el aislamiento/validación se hace
 * en la capa de controladores/servicios.
 *
 * Idempotente: columnas/tablas ya existentes se omiten. La Fase B también es
 * idempotente (los UPDATE solo afectan filas que todavía tengan el valor
 * legacy; una segunda corrida no vuelve a tocar nada).
 *
 * Rollback manual si hiciera falta (no se corre acá):
 *   DROP TABLE IF EXISTS liquidacion_envios;
 *   DROP TABLE IF EXISTS liquidaciones;
 *   ALTER TABLE metodos_pago DROP COLUMN IF EXISTS custodia_cobro;
 *   DROP TYPE IF EXISTS "enum_metodos_pago_custodia_cobro";
 *   ALTER TABLE productos DROP COLUMN IF EXISTS cantidad_reservada, DROP COLUMN IF EXISTS cantidad_transito;
 *   ALTER TABLE envio_item_componentes DROP COLUMN IF EXISTS cantidad_devuelta_vendible,
 *     DROP COLUMN IF EXISTS cantidad_devuelta_danada, DROP COLUMN IF EXISTS cantidad_perdida;
 *   ALTER TABLE envios DROP COLUMN IF EXISTS estado_financiero, DROP COLUMN IF EXISTS fecha_reprogramada,
 *     DROP COLUMN IF EXISTS motivo_reprogramacion, DROP COLUMN IF EXISTS stock_despachado,
 *     DROP COLUMN IF EXISTS stock_liberado, DROP COLUMN IF EXISTS cargo_perdida_courier;
 *   DROP TYPE IF EXISTS "enum_envios_estado_financiero";
 *   -- Nota: la Fase B (conversión de datos) NO tiene rollback automático:
 *   -- una vez reescrito 'Rendido'/'En camino'/'Reagendado' no se puede saber
 *   -- con certeza cuál era el valor original de cada fila.
 *
 * Ejecutar (estructura solamente, Fase A): node scripts/migrar-gestion-pedidos.js
 * Ejecutar structura + datos (Fase A + Fase B): node scripts/migrar-gestion-pedidos.js --con-datos
 *   ⚠ Requiere confirmación explícita del usuario antes de correr con --con-datos.
 */

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../src/models');

async function migrarEstructura(t) {
  const qi = sequelize.getQueryInterface();
  const tablas = await qi.showAllTables();

  // --- envios ---
  const columnasEnvios = await qi.describeTable('envios');

  if (!columnasEnvios.estado_financiero) {
    await qi.addColumn('envios', 'estado_financiero', {
      type: DataTypes.ENUM('pendiente_liquidacion', 'liquidado'),
      allowNull: false,
      defaultValue: 'pendiente_liquidacion',
    }, { transaction: t });
    console.log('  ✓ "envios.estado_financiero" agregada.');
  } else {
    console.log('  "envios.estado_financiero" ya existe, se omite.');
  }

  if (!columnasEnvios.fecha_reprogramada) {
    await qi.addColumn('envios', 'fecha_reprogramada', { type: DataTypes.DATEONLY, allowNull: true }, { transaction: t });
    console.log('  ✓ "envios.fecha_reprogramada" agregada.');
  } else {
    console.log('  "envios.fecha_reprogramada" ya existe, se omite.');
  }

  if (!columnasEnvios.motivo_reprogramacion) {
    await qi.addColumn('envios', 'motivo_reprogramacion', { type: DataTypes.STRING(255), allowNull: true }, { transaction: t });
    console.log('  ✓ "envios.motivo_reprogramacion" agregada.');
  } else {
    console.log('  "envios.motivo_reprogramacion" ya existe, se omite.');
  }

  if (!columnasEnvios.stock_despachado) {
    await qi.addColumn('envios', 'stock_despachado', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, { transaction: t });
    console.log('  ✓ "envios.stock_despachado" agregada.');
  } else {
    console.log('  "envios.stock_despachado" ya existe, se omite.');
  }

  if (!columnasEnvios.stock_liberado) {
    await qi.addColumn('envios', 'stock_liberado', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, { transaction: t });
    console.log('  ✓ "envios.stock_liberado" agregada.');
  } else {
    console.log('  "envios.stock_liberado" ya existe, se omite.');
  }

  if (!columnasEnvios.cargo_perdida_courier) {
    await qi.addColumn('envios', 'cargo_perdida_courier', { type: DataTypes.INTEGER, allowNull: true }, { transaction: t });
    console.log('  ✓ "envios.cargo_perdida_courier" agregada.');
  } else {
    console.log('  "envios.cargo_perdida_courier" ya existe, se omite.');
  }

  // --- envio_item_componentes ---
  const columnasComponentes = await qi.describeTable('envio_item_componentes');

  if (!columnasComponentes.cantidad_devuelta_vendible) {
    await qi.addColumn('envio_item_componentes', 'cantidad_devuelta_vendible', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, { transaction: t });
    console.log('  ✓ "envio_item_componentes.cantidad_devuelta_vendible" agregada.');
  } else {
    console.log('  "envio_item_componentes.cantidad_devuelta_vendible" ya existe, se omite.');
  }

  if (!columnasComponentes.cantidad_devuelta_danada) {
    await qi.addColumn('envio_item_componentes', 'cantidad_devuelta_danada', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, { transaction: t });
    console.log('  ✓ "envio_item_componentes.cantidad_devuelta_danada" agregada.');
  } else {
    console.log('  "envio_item_componentes.cantidad_devuelta_danada" ya existe, se omite.');
  }

  if (!columnasComponentes.cantidad_perdida) {
    await qi.addColumn('envio_item_componentes', 'cantidad_perdida', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, { transaction: t });
    console.log('  ✓ "envio_item_componentes.cantidad_perdida" agregada.');
  } else {
    console.log('  "envio_item_componentes.cantidad_perdida" ya existe, se omite.');
  }

  // --- productos ---
  const columnasProductos = await qi.describeTable('productos');

  if (!columnasProductos.cantidad_reservada) {
    await qi.addColumn('productos', 'cantidad_reservada', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, { transaction: t });
    console.log('  ✓ "productos.cantidad_reservada" agregada.');
  } else {
    console.log('  "productos.cantidad_reservada" ya existe, se omite.');
  }

  if (!columnasProductos.cantidad_transito) {
    await qi.addColumn('productos', 'cantidad_transito', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, { transaction: t });
    console.log('  ✓ "productos.cantidad_transito" agregada.');
  } else {
    console.log('  "productos.cantidad_transito" ya existe, se omite.');
  }

  // --- metodos_pago ---
  const columnasMetodosPago = await qi.describeTable('metodos_pago');

  if (!columnasMetodosPago.custodia_cobro) {
    await qi.addColumn('metodos_pago', 'custodia_cobro', {
      type: DataTypes.ENUM('negocio', 'courier'),
      allowNull: false,
      defaultValue: 'negocio',
    }, { transaction: t });
    console.log('  ✓ "metodos_pago.custodia_cobro" agregada.');
  } else {
    console.log('  "metodos_pago.custodia_cobro" ya existe, se omite.');
  }

  // --- liquidaciones ---
  if (!tablas.includes('liquidaciones')) {
    await qi.createTable('liquidaciones', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      usuario_id: { type: DataTypes.INTEGER, allowNull: false },
      courier_id: { type: DataTypes.INTEGER, allowNull: false },
      fecha_desde: { type: DataTypes.DATEONLY, allowNull: false },
      fecha_hasta: { type: DataTypes.DATEONLY, allowNull: false },
      total_dinero_courier: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      total_costo_servicios: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      total_cargos_perdida: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      ajuste_manual: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      saldo_final: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      observacion: { type: DataTypes.TEXT, allowNull: true },
      usuario_registro_id: { type: DataTypes.INTEGER, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    }, { transaction: t });
    await qi.addIndex('liquidaciones', ['usuario_id'], { transaction: t });
    await qi.addIndex('liquidaciones', ['courier_id'], { transaction: t });
    console.log('  ✓ tabla "liquidaciones" creada.');
  } else {
    console.log('  "liquidaciones" ya existe, se omite.');
  }

  // --- liquidacion_envios ---
  if (!tablas.includes('liquidacion_envios')) {
    await qi.createTable('liquidacion_envios', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      liquidacion_id: { type: DataTypes.INTEGER, allowNull: false },
      envio_id: { type: DataTypes.INTEGER, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
    }, { transaction: t });
    await qi.addIndex('liquidacion_envios', ['liquidacion_id'], { transaction: t });
    await qi.addIndex('liquidacion_envios', ['envio_id'], { transaction: t });
    await qi.addIndex('liquidacion_envios', ['liquidacion_id', 'envio_id'], { unique: true, name: 'liquidacion_envios_liquidacion_envio_unique', transaction: t });
    console.log('  ✓ tabla "liquidacion_envios" creada.');
  } else {
    console.log('  "liquidacion_envios" ya existe, se omite.');
  }
}

/**
 * FASE B — reescribe los valores legacy de `envios.estado` al catálogo
 * nuevo de 9 valores. Cada UPDATE reporta cuántas filas tocó. Solo se llama
 * si el caller pasa --con-datos (ver bloque de ejecución al final) — nunca
 * se ejecuta automáticamente junto con la Fase A.
 */
async function migrarDatosLegacy(t) {
  const [, metaDespachado] = await sequelize.query(
    `UPDATE envios SET estado = 'Despachado' WHERE estado IN ('En camino', 'En Tránsito')`,
    { transaction: t }
  );
  console.log(`  ✓ 'En camino'/'En Tránsito' → 'Despachado': ${metaDespachado.rowCount} fila(s).`);

  const [, metaReprogramado] = await sequelize.query(
    `UPDATE envios SET estado = 'Reprogramado' WHERE estado = 'Reagendado'`,
    { transaction: t }
  );
  console.log(`  ✓ 'Reagendado' → 'Reprogramado': ${metaReprogramado.rowCount} fila(s).`);

  const [, metaRendido] = await sequelize.query(
    `UPDATE envios SET estado = 'Entregado', estado_financiero = 'liquidado' WHERE estado = 'Rendido'`,
    { transaction: t }
  );
  console.log(`  ✓ 'Rendido' → 'Entregado' + estado_financiero='liquidado': ${metaRendido.rowCount} fila(s).`);

  const [restantesLegacy] = await sequelize.query(
    `SELECT estado, COUNT(*) AS cantidad FROM envios WHERE estado IN ('En camino', 'En Tránsito', 'Reagendado', 'Rendido') GROUP BY estado`,
    { transaction: t }
  );
  if (restantesLegacy.length > 0) {
    throw new Error('Quedaron estados legacy sin convertir: ' + JSON.stringify(restantesLegacy));
  }
  console.log('  ✓ Verificado: no quedan estados legacy en "envios".');
}

async function migrar({ conDatos = false } = {}) {
  const t = await sequelize.transaction();
  try {
    console.log('Fase A — estructura:');
    await migrarEstructura(t);

    if (conDatos) {
      console.log('\nFase B — datos:');
      await migrarDatosLegacy(t);
    } else {
      console.log('\nFase B — datos: omitida (correr con --con-datos para aplicarla).');
    }

    await t.commit();
    console.log('\nMigración completada.');
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

module.exports = { migrarGestionPedidos: migrar };

if (require.main === module) {
  const conDatos = process.argv.includes('--con-datos');
  migrar({ conDatos })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Error durante la migración:', err.message);
      process.exit(1);
    });
}
