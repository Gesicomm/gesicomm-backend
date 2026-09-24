'use strict';

/**
 * Logo a nivel tienda: se sube desde Mi Tienda y es el default de todas las
 * páginas del sitio. Una landing con logo propio (Landing.logo_imagen o el
 * logo del bloque Header del armador) lo sigue pisando. Mismas columnas que
 * Landing.logo_imagen_* para reusar el mismo contrato de ImagenService.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE tiendas
        ADD COLUMN IF NOT EXISTS logo_imagen VARCHAR(700),
        ADD COLUMN IF NOT EXISTS logo_imagen_storage_key VARCHAR(700),
        ADD COLUMN IF NOT EXISTS logo_imagen_mime_type VARCHAR(100),
        ADD COLUMN IF NOT EXISTS logo_imagen_size INTEGER,
        ADD COLUMN IF NOT EXISTS logo_imagen_width INTEGER,
        ADD COLUMN IF NOT EXISTS logo_imagen_height INTEGER;

      COMMENT ON COLUMN tiendas.logo_imagen IS
        'URL pública del logo de la tienda. Default de todas las landings sin logo propio.';
      COMMENT ON COLUMN tiendas.logo_imagen_storage_key IS
        'Key R2 del logo, para borrarlo al reemplazarlo o quitarlo.';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE tiendas
        DROP COLUMN IF EXISTS logo_imagen_height,
        DROP COLUMN IF EXISTS logo_imagen_width,
        DROP COLUMN IF EXISTS logo_imagen_size,
        DROP COLUMN IF EXISTS logo_imagen_mime_type,
        DROP COLUMN IF EXISTS logo_imagen_storage_key,
        DROP COLUMN IF EXISTS logo_imagen;
    `);
  },
};
