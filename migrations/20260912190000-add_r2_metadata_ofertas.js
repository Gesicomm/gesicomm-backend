'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.ofertas_producto
          ADD COLUMN IF NOT EXISTS imagen_storage_key VARCHAR(700),
          ADD COLUMN IF NOT EXISTS imagen_mime_type VARCHAR(100),
          ADD COLUMN IF NOT EXISTS imagen_size INTEGER,
          ADD COLUMN IF NOT EXISTS imagen_width INTEGER,
          ADD COLUMN IF NOT EXISTS imagen_height INTEGER;

        COMMENT ON COLUMN public.ofertas_producto.imagen_storage_key IS
          'Key del objeto en Cloudflare R2. imagen_url (URL) se conserva para compatibilidad de API. Null si imagen_url fue seteada como texto libre (no subida por archivo).';
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.ofertas_producto
          DROP COLUMN IF EXISTS imagen_storage_key,
          DROP COLUMN IF EXISTS imagen_mime_type,
          DROP COLUMN IF EXISTS imagen_size,
          DROP COLUMN IF EXISTS imagen_width,
          DROP COLUMN IF EXISTS imagen_height;
      `, { transaction });
    });
  },
};
