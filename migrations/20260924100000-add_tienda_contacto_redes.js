'use strict';

/**
 * Email y redes sociales a nivel TIENDA. Se cargan en el onboarding y en
 * Configurar tienda, y son el valor por defecto del contacto de todas las
 * landings (landing.contacto_* sigue pisándolos si el comercio los cambia
 * en una landing puntual). Antes solo existían por landing, así que una
 * landing nueva — sobre todo "Lienzo en blanco", que no tiene panel de
 * contacto — salía sin redes aunque la tienda las tuviera.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE tiendas
        ADD COLUMN IF NOT EXISTS email VARCHAR(150),
        ADD COLUMN IF NOT EXISTS instagram VARCHAR(100),
        ADD COLUMN IF NOT EXISTS facebook VARCHAR(100),
        ADD COLUMN IF NOT EXISTS tiktok VARCHAR(100),
        ADD COLUMN IF NOT EXISTS youtube VARCHAR(100);

      COMMENT ON COLUMN tiendas.email IS 'Email de contacto público. Default del contacto de las landings.';
      COMMENT ON COLUMN tiendas.instagram IS 'Usuario (@tienda) o URL. Default de landing.contacto_instagram.';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE tiendas
        DROP COLUMN IF EXISTS youtube,
        DROP COLUMN IF EXISTS tiktok,
        DROP COLUMN IF EXISTS facebook,
        DROP COLUMN IF EXISTS instagram,
        DROP COLUMN IF EXISTS email;
    `);
  },
};
