'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.landings
          ADD COLUMN IF NOT EXISTS banner_imagen_storage_key VARCHAR(700),
          ADD COLUMN IF NOT EXISTS banner_imagen_mime_type VARCHAR(100),
          ADD COLUMN IF NOT EXISTS banner_imagen_size INTEGER,
          ADD COLUMN IF NOT EXISTS banner_imagen_width INTEGER,
          ADD COLUMN IF NOT EXISTS banner_imagen_height INTEGER,
          ADD COLUMN IF NOT EXISTS seo_og_imagen_storage_key VARCHAR(700),
          ADD COLUMN IF NOT EXISTS seo_og_imagen_mime_type VARCHAR(100),
          ADD COLUMN IF NOT EXISTS seo_og_imagen_size INTEGER,
          ADD COLUMN IF NOT EXISTS seo_og_imagen_width INTEGER,
          ADD COLUMN IF NOT EXISTS seo_og_imagen_height INTEGER;

        COMMENT ON COLUMN public.landings.banner_imagen_storage_key IS
          'Key del objeto en Cloudflare R2. banner_imagen (URL) se conserva para compatibilidad de API.';
        COMMENT ON COLUMN public.landings.seo_og_imagen_storage_key IS
          'Key del objeto en Cloudflare R2. seo_og_imagen (URL) se conserva para compatibilidad de API.';
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.landings
          DROP COLUMN IF EXISTS banner_imagen_storage_key,
          DROP COLUMN IF EXISTS banner_imagen_mime_type,
          DROP COLUMN IF EXISTS banner_imagen_size,
          DROP COLUMN IF EXISTS banner_imagen_width,
          DROP COLUMN IF EXISTS banner_imagen_height,
          DROP COLUMN IF EXISTS seo_og_imagen_storage_key,
          DROP COLUMN IF EXISTS seo_og_imagen_mime_type,
          DROP COLUMN IF EXISTS seo_og_imagen_size,
          DROP COLUMN IF EXISTS seo_og_imagen_width,
          DROP COLUMN IF EXISTS seo_og_imagen_height;
      `, { transaction });
    });
  },
};
