'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_funnel_producto') THEN
          ALTER TABLE landings ADD CONSTRAINT chk_funnel_producto CHECK (tipo_pagina != 'funnel' OR producto_id IS NOT NULL);
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_funnel_no_home') THEN
          ALTER TABLE landings ADD CONSTRAINT chk_funnel_no_home CHECK (tipo_pagina != 'funnel' OR es_home = false);
        END IF;
      END $$;
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE landings DROP CONSTRAINT IF EXISTS chk_funnel_producto;
      ALTER TABLE landings DROP CONSTRAINT IF EXISTS chk_funnel_no_home;
    `);
  }
};
