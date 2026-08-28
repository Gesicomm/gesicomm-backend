'use strict';

module.exports = {
  async up(queryInterface) {
    // 1. Índice único parcial: solo puede haber UN es_home=true por tienda_id
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unico_home_por_tienda
      ON landings (tienda_id)
      WHERE es_home = true;
    `);

    // 2. Check constraint: es_home=true solo es válido con tipo_pagina='inicio'
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_home_solo_inicio'
        ) THEN
          ALTER TABLE landings
            ADD CONSTRAINT chk_home_solo_inicio
            CHECK (es_home = false OR tipo_pagina = 'inicio');
        END IF;
      END
      $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS idx_unico_home_por_tienda;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE landings DROP CONSTRAINT IF EXISTS chk_home_solo_inicio;
    `);
  },
};
