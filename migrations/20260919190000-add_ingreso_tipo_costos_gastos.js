'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_costos_gastos_tipo') THEN
          ALTER TYPE "enum_costos_gastos_tipo" ADD VALUE IF NOT EXISTS 'ingreso';
        END IF;
      END $$;
    `);
  },

  async down() {
    // PostgreSQL no permite quitar valores de un ENUM sin recrear columnas y datos.
    // Se deja no-op para evitar pérdida accidental de movimientos financieros.
  },
};
