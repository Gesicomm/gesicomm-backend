'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE ofertas_producto
        ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(500),
        ADD COLUMN IF NOT EXISTS fecha_inicio DATE,
        ADD COLUMN IF NOT EXISTS fecha_fin DATE;

      COMMENT ON COLUMN ofertas_producto.imagen_url IS
        'Imagen propia de la oferta. NULL = se usa la del producto ancla.';
      COMMENT ON COLUMN ofertas_producto.fecha_inicio IS
        'Desde cuándo se ofrece (inclusive). NULL = sin fecha de inicio.';
      COMMENT ON COLUMN ofertas_producto.fecha_fin IS
        'Hasta cuándo se ofrece (inclusive). NULL = sin vencimiento. Fuera de la ventana la oferta no se muestra ni se puede cobrar, aunque activo siga en true.';

      CREATE INDEX IF NOT EXISTS ofertas_producto_vigencia_idx
        ON ofertas_producto (fecha_inicio, fecha_fin);
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS ofertas_producto_vigencia_idx;

      ALTER TABLE ofertas_producto
        DROP COLUMN IF EXISTS imagen_url,
        DROP COLUMN IF EXISTS fecha_inicio,
        DROP COLUMN IF EXISTS fecha_fin;
    `);
  }
};
