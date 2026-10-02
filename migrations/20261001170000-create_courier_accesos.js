'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS public.courier_accesos (
        id SERIAL PRIMARY KEY,
        courier_id INTEGER NOT NULL REFERENCES public.couriers(id) ON DELETE CASCADE,
        usuario_id INTEGER NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
        username VARCHAR(80) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        activo BOOLEAN NOT NULL DEFAULT true,
        ultimo_acceso TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_courier_accesos_courier
        ON public.courier_accesos (courier_id);

      CREATE UNIQUE INDEX IF NOT EXISTS uq_courier_accesos_username
        ON public.courier_accesos (LOWER(username));

      CREATE INDEX IF NOT EXISTS idx_courier_accesos_usuario
        ON public.courier_accesos (usuario_id);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS public.courier_accesos;
    `);
  },
};
