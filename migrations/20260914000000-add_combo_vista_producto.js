'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE producto_combos
        ADD COLUMN IF NOT EXISTS sobre_este_producto TEXT,
        ADD COLUMN IF NOT EXISTS propuesta_valor TEXT,
        ADD COLUMN IF NOT EXISTS beneficios JSON DEFAULT '[]'::json,
        ADD COLUMN IF NOT EXISTS confianza JSON DEFAULT '[]'::json,
        ADD COLUMN IF NOT EXISTS preguntas_frecuentes JSON DEFAULT '[]'::json,
        ADD COLUMN IF NOT EXISTS faq_titulo VARCHAR(255),
        ADD COLUMN IF NOT EXISTS relacionados_titulo VARCHAR(255),
        ADD COLUMN IF NOT EXISTS ficha_rubro VARCHAR(40),
        ADD COLUMN IF NOT EXISTS ficha_datos JSONB NOT NULL DEFAULT '{}'::jsonb;

      COMMENT ON COLUMN producto_combos.ficha_rubro IS
        'Qué juego de campos usa la ficha de este combo, igual que Producto.ficha_rubro. NULL = genérico.';
      COMMENT ON COLUMN producto_combos.ficha_datos IS
        'Campos propios del rubro del combo, misma forma que Producto.ficha_datos.';
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE producto_combos
        DROP COLUMN IF EXISTS sobre_este_producto,
        DROP COLUMN IF EXISTS propuesta_valor,
        DROP COLUMN IF EXISTS beneficios,
        DROP COLUMN IF EXISTS confianza,
        DROP COLUMN IF EXISTS preguntas_frecuentes,
        DROP COLUMN IF EXISTS faq_titulo,
        DROP COLUMN IF EXISTS relacionados_titulo,
        DROP COLUMN IF EXISTS ficha_rubro,
        DROP COLUMN IF EXISTS ficha_datos;
    `);
  }
};
