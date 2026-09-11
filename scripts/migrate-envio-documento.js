'use strict';

/**
 * Migración única: agrega `documento` (cédula del comprador) a Envio.
 *
 * PagoPar exige `comprador.documento` para cobrar online, y hasta ahora el
 * checkout solo guardaba `ruc`. Son cosas distintas: la cédula identifica a
 * la persona y la pide la pasarela SIEMPRE; el RUC solo hace falta si el
 * comprador quiere factura (y ahí se cobra IVA).
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
      comment: 'Cedula del comprador. Obligatoria para cobrar online (PagoPar comprador.documento).',
    });
    console.log('\n✓ Listo.');
  } catch (err) {
    console.error('\n✗ Falló:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

main();
