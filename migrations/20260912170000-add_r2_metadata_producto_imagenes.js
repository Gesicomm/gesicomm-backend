'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.producto_imagenes
          ADD COLUMN IF NOT EXISTS storage_key VARCHAR(700),
          ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100),
          ADD COLUMN IF NOT EXISTS size INTEGER,
          ADD COLUMN IF NOT EXISTS width INTEGER,
          ADD COLUMN IF NOT EXISTS height INTEGER;

        CREATE INDEX IF NOT EXISTS producto_imagenes_storage_key_idx
          ON public.producto_imagenes (storage_key);

        COMMENT ON COLUMN public.producto_imagenes.storage_key IS
          'Key del objeto en Cloudflare R2. url se conserva para compatibilidad de API.';
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        DROP INDEX IF EXISTS public.producto_imagenes_storage_key_idx;

        ALTER TABLE public.producto_imagenes
          DROP COLUMN IF EXISTS storage_key,
          DROP COLUMN IF EXISTS mime_type,
          DROP COLUMN IF EXISTS size,
          DROP COLUMN IF EXISTS width,
          DROP COLUMN IF EXISTS height;
      `, { transaction });
    });
  },
};
