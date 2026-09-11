'use strict';

/**
 * Migración única: agrega `documento` (cédula del comprador) a Envio.
 *
 * El checkout público de la landing guarda sus pedidos como Envio, y hasta
 * ahora solo tenía `ruc`. Son cosas distintas: la cédula identifica a la
 * persona y la pide PagoPar SIEMPRE para cobrar online (`comprador.documento`,
 * con `tipo_documento` fijo en "CI"); el RUC solo hace falta si el comprador
 * pide factura.
 *
 * Nullable: los pedidos que ya existen no tienen el dato y no hay de dónde
 * sacarlo. Sin backfill inventado.
 *
 * Idempotente. Ejecutar:
 *   node scripts/migrate-envio-documento.js
 */

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../src/models');

async function main() {
  const qi = sequelize.getQueryInterface();
  try {
    const columnas = await qi.describeTable('envios');
    if (columnas.documento) {
      console.log('→ La columna "documento" ya existe en envios.');
      return;
    }

    console.log('→ Agregando "documento" a envios...');
    await qi.addColumn('envios', 'documento', {
      type: DataTypes.STRING(30),
      allowNull: true,
      comment: 'Cedula del comprador. La pide PagoPar para cobrar online.',
    });

    const [[fila]] = await sequelize.query('SELECT COUNT(*)::int AS total FROM envios');
    console.log(`\n✓ Listo. ${fila.total} pedido(s) existentes quedan con documento en null.`);
  } catch (err) {
    console.error('\n✗ Falló:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

main();
