'use strict';

/**
 * Stock de variante separado en salón y depósito.
 *
 * Online se vende el TOTAL: `stock` sigue siendo la única columna que mira
 * el motor de precios/stock y el checkout, y el backend la mantiene como
 * stock_salon + stock_deposito. El desglose es para que el comercio sepa
 * dónde está físicamente la mercadería.
 *
 * Backfill: el stock que ya existía se toma como stock de salón — es lo que
 * el comercio venía viendo y vendiendo. Así la suma da exactamente el mismo
 * total de antes y ninguna variante cambia de disponibilidad.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE producto_variantes
        ADD COLUMN IF NOT EXISTS stock_salon INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS stock_deposito INTEGER NOT NULL DEFAULT 0;

      UPDATE producto_variantes
         SET stock_salon = stock
       WHERE stock_salon = 0
         AND stock > 0;

      COMMENT ON COLUMN producto_variantes.stock_salon IS
        'Unidades en el salón / mostrador, a la vista del cliente.';
      COMMENT ON COLUMN producto_variantes.stock_deposito IS
        'Unidades guardadas en depósito. Se venden igual: el stock online es la suma de ambos.';
      COMMENT ON COLUMN producto_variantes.stock IS
        'Stock total vendible = stock_salon + stock_deposito. Lo mantiene el backend; no se escribe a mano.';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE producto_variantes
        DROP COLUMN IF EXISTS stock_salon,
        DROP COLUMN IF EXISTS stock_deposito;
    `);
  }
};
