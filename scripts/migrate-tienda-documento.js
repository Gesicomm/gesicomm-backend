'use strict';

/**
 * Migración única: agrega `documento` (cédula) y `ruc` a Tienda.
 *
 * PagoPar exige `comprador.documento` — la cédula — en iniciar-transaccion, y
 * el comercio del SISTEMA (el que cobra abastecimiento y suscripciones) lo
 * rechaza si viene vacío: "El documento debe estar presente.". Hasta ahora el
 * único documento en todo el modelo era Envio.ruc, que es del comprador final
 * y no del comerciante.
 *
 * Las dos columnas van nullable: las tiendas que ya existen no tienen el dato
 * y no hay de dónde sacarlo, así que NO se hace backfill con valores
 * inventados. El onboarding lo exige de acá en adelante y las tiendas viejas
 * lo cargan desde /mi-tienda.
 *
 * Idempotente. Ejecutar:
 *   node scripts/migrate-tienda-documento.js
 */

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../src/models');

async function main() {
  const qi = sequelize.getQueryInterface();
  const t = await sequelize.transaction();
  try {
    const columnas = await qi.describeTable('tiendas');

    if (!columnas.documento) {
      console.log('→ Agregando "documento" a tiendas...');
      await qi.addColumn('tiendas', 'documento', {
        type: DataTypes.STRING(30),
        allowNull: true,
        comment: 'Cedula del titular. Va como comprador.documento en PagoPar.',
      }, { transaction: t });
    } else {
      console.log('  "documento" ya existe.');
    }

    if (!columnas.ruc) {
      console.log('→ Agregando "ruc" a tiendas...');
      await qi.addColumn('tiendas', 'ruc', {
        type: DataTypes.STRING(30),
        allowNull: true,
        comment: 'RUC del comercio. Opcional.',
      }, { transaction: t });
    } else {
      console.log('  "ruc" ya existe.');
    }

    await t.commit();

    const [[fila]] = await sequelize.query(
      'SELECT COUNT(*)::int AS total, COUNT(documento)::int AS con_doc FROM tiendas',
    );
    console.log(`\n✓ Listo. ${fila.total} tienda(s), ${fila.con_doc} con documento cargado.`);
    if (fila.total > fila.con_doc) {
      console.log(`  ${fila.total - fila.con_doc} sin documento: lo cargan desde /mi-tienda.`);
    }
  } catch (err) {
    await t.rollback();
    console.error('\n✗ Falló, no quedó nada a medias:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

main();
