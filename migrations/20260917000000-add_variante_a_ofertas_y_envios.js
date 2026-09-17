'use strict';

/**
 * Dos cosas relacionadas, mismo punto de intervención en el checkout:
 *
 * 1) Un componente de Oferta (order bump/upsell/combo) puede apuntar a una
 *    variante específica del producto que agrega, o dejar que el cliente la
 *    elija en la landing (`permite_elegir_variante`). Las variantes en sí
 *    nunca se definen acá — siempre salen de producto_variantes, la misma
 *    fuente de verdad que usa la ficha del producto.
 *
 * 2) Fix de fondo: hasta ahora el stock de una variante nunca se descontaba
 *    de verdad al confirmar un pedido (ni para el producto ancla ni para
 *    los componentes de una oferta) — envio_items/envio_item_componentes no
 *    tenían columna para saber qué variante se vendió, así que
 *    envioController.js siempre pisaba el total del producto padre.
 *    `variante_id` en envio_items = variante del producto ANCLA de esa
 *    línea. `componente_variante_id` = lo que el cliente eligió para el
 *    componente elegible del bump/upsell de esa línea, si tenía uno.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE oferta_componentes
        ADD COLUMN IF NOT EXISTS variante_id INTEGER NULL REFERENCES producto_variantes(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS permite_elegir_variante BOOLEAN NOT NULL DEFAULT false;
    `);

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_oferta_componentes_oferta_producto_variante
      ON oferta_componentes (oferta_id, producto_id, variante_id);
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE envio_items
        ADD COLUMN IF NOT EXISTS variante_id INTEGER NULL REFERENCES producto_variantes(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS componente_variante_id INTEGER NULL REFERENCES producto_variantes(id) ON DELETE SET NULL;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE envio_item_componentes
        ADD COLUMN IF NOT EXISTS variante_id INTEGER NULL REFERENCES producto_variantes(id) ON DELETE SET NULL;
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS uq_oferta_componentes_oferta_producto_variante;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE oferta_componentes
        DROP COLUMN IF EXISTS variante_id,
        DROP COLUMN IF EXISTS permite_elegir_variante;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE envio_items
        DROP COLUMN IF EXISTS variante_id,
        DROP COLUMN IF EXISTS componente_variante_id;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE envio_item_componentes
        DROP COLUMN IF EXISTS variante_id;
    `);
  }
};
