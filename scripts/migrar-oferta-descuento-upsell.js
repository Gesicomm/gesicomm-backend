'use strict';

/**
 * Script de migración — descuento por componente en Ofertas tipo "combo".
 *
 * Agrega a "oferta_componentes":
 *   - descuento_porcentaje  DECIMAL(5,2) NOT NULL DEFAULT 0
 *
 * Es el equivalente, dentro de una Oferta combo, al "descuento por upsell"
 * que ya existe en ProductoCombo (ver utils/comboPricing.js) — alimenta el
 * análisis de sensibilidad/margen unificado, no afecta el precio real
 * cobrado (Oferta.precio sigue siendo el único precio de venta).
 *
 * Sin FK real, sin impacto en filas existentes (quedan en 0 = "sin
 * descuento", comportamiento idéntico al actual).
 *
 * Idempotente: si la columna ya existe, se omite.
 *
 * Ejecutar: node scripts/migrar-oferta-descuento-upsell.js
 */

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../src/models');

async function migrar() {
  const qi = sequelize.getQueryInterface();
  const t = await sequelize.transaction();

  try {
    const columnas = await qi.describeTable('oferta_componentes');

    if (!columnas.descuento_porcentaje) {
      await qi.addColumn('oferta_componentes', 'descuento_porcentaje', {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0,
      }, { transaction: t });
      console.log('  ✓ "oferta_componentes.descuento_porcentaje" agregada.');
    } else {
      console.log('  "oferta_componentes.descuento_porcentaje" ya existe, se omite.');
    }

    await t.commit();
    console.log('\nMigración completada.');
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

module.exports = { migrarOfertaDescuentoUpsell: migrar };

if (require.main === module) {
  migrar()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Error durante la migración:', err.message);
      process.exit(1);
    });
}
