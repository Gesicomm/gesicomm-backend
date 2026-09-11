'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.envios
        ADD COLUMN IF NOT EXISTS abastecimiento_notificado_at TIMESTAMPTZ;

      COMMENT ON COLUMN public.envios.abastecimiento_notificado_at IS
        'Cuándo se notificó al usuario que debe pagar el abastecimiento Gesicom. Idempotencia para no duplicar emails.';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.envios
        DROP COLUMN IF EXISTS abastecimiento_notificado_at;
    `);
  },
};
