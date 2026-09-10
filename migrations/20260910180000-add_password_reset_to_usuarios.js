'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.usuarios
          ADD COLUMN IF NOT EXISTS password_reset_token_hash VARCHAR(64),
          ADD COLUMN IF NOT EXISTS password_reset_expira TIMESTAMPTZ;

        CREATE INDEX IF NOT EXISTS usuarios_password_reset_token_hash_idx
          ON public.usuarios (password_reset_token_hash)
          WHERE password_reset_token_hash IS NOT NULL;

        COMMENT ON COLUMN public.usuarios.password_reset_token_hash IS
          'Hash SHA-256 del token de recuperacion de contrasena. El token crudo solo viaja por email.';

        COMMENT ON COLUMN public.usuarios.password_reset_expira IS
          'Timestamp de expiracion del enlace de recuperacion de contrasena.';
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        DROP INDEX IF EXISTS public.usuarios_password_reset_token_hash_idx;

        ALTER TABLE public.usuarios
          DROP COLUMN IF EXISTS password_reset_token_hash,
          DROP COLUMN IF EXISTS password_reset_expira;
      `, { transaction });
    });
  },
};
