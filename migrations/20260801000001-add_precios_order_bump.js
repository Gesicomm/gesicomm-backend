'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TYPE enum_ofertas_producto_estrategia ADD VALUE IF NOT EXISTS 'combo';
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE ofertas_producto
        ADD COLUMN IF NOT EXISTS precio_normal INTEGER,
        ADD COLUMN IF NOT EXISTS precio_order_bump INTEGER;

      COMMENT ON COLUMN ofertas_producto.precio_normal IS
        'Precio de la oferta vendida por el canal normal (ficha del producto / combo). Es el precio de referencia para reportería.';
      COMMENT ON COLUMN ofertas_producto.precio_order_bump IS
        'Precio promocional cobrado SOLO cuando la oferta se acepta como Order Bump en el checkout. NULL = no se ofrece como bump (cae a precio_normal).';

      UPDATE ofertas_producto SET precio_normal = precio WHERE precio_normal IS NULL;
      UPDATE ofertas_producto SET precio_order_bump = precio
        WHERE precio_order_bump IS NULL AND estrategia = 'order_bump';

      ALTER TABLE ofertas_producto ALTER COLUMN precio_normal SET DEFAULT 0;
      ALTER TABLE ofertas_producto ALTER COLUMN precio_normal SET NOT NULL;

      ALTER TABLE envio_items
        ADD COLUMN IF NOT EXISTS origen_venta VARCHAR(20) NOT NULL DEFAULT 'normal',
        ADD COLUMN IF NOT EXISTS precio_normal INTEGER;

      COMMENT ON COLUMN envio_items.origen_venta IS
        'Canal por el que se vendió esta línea: normal | order_bump | upsell | combo. Snapshot al momento de la venta.';
      COMMENT ON COLUMN envio_items.precio_normal IS
        'Precio unitario que habría tenido esta línea por el canal normal. Contra precio_unitario da el descuento concedido por el bump.';

      UPDATE envio_items ei
         SET origen_venta = op.estrategia::text
        FROM ofertas_producto op
       WHERE ei.oferta_id = op.id
         AND ei.origen_venta = 'normal'
         AND op.estrategia::text <> 'normal';

      CREATE INDEX IF NOT EXISTS envio_items_origen_venta_idx ON envio_items (origen_venta);
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS envio_items_origen_venta_idx;

      ALTER TABLE envio_items
        DROP COLUMN IF EXISTS origen_venta,
        DROP COLUMN IF EXISTS precio_normal;

      ALTER TABLE ofertas_producto
        DROP COLUMN IF EXISTS precio_normal,
        DROP COLUMN IF EXISTS precio_order_bump;
    `);
  }
};
