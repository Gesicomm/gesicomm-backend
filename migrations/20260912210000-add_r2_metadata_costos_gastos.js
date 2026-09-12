'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.costos_gastos
          ADD COLUMN IF NOT EXISTS comprobante_storage_key VARCHAR(700),
          ADD COLUMN IF NOT EXISTS comprobante_mime_type VARCHAR(100),
          ADD COLUMN IF NOT EXISTS comprobante_size INTEGER;

        COMMENT ON COLUMN public.costos_gastos.comprobante_storage_key IS
          'Key del objeto en Cloudflare R2 (imagen webp o PDF). comprobante_url (URL) se conserva para compatibilidad de API.';
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.costos_gastos
          DROP COLUMN IF EXISTS comprobante_storage_key,
          DROP COLUMN IF EXISTS comprobante_mime_type,
          DROP COLUMN IF EXISTS comprobante_size;
      `, { transaction });
    });
  },
};
