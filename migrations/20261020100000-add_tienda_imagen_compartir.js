'use strict';

/** Imagen Open Graph general para la portada de cada tienda. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE tiendas
        ADD COLUMN IF NOT EXISTS compartir_imagen VARCHAR(700),
        ADD COLUMN IF NOT EXISTS compartir_imagen_storage_key VARCHAR(700);
      COMMENT ON COLUMN tiendas.compartir_imagen IS 'URL pública de la miniatura Open Graph de la tienda (WebP 1200x630 en R2).';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE tiendas
        DROP COLUMN IF EXISTS compartir_imagen,
        DROP COLUMN IF EXISTS compartir_imagen_storage_key;
    `);
  },
};
