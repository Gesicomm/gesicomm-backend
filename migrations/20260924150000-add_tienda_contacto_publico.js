'use strict';

/**
 * Contacto público ampliado de la Tienda (pantalla Configurar tienda →
 * Contacto): quién atiende, por qué canal prefiere que le escriban, X y la
 * dirección/ciudad que se muestran en las landings. Igual que email y
 * redes (20260924100000), son el default del contacto de todas las landings.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE tiendas
        ADD COLUMN IF NOT EXISTS nombre_contacto VARCHAR(100),
        ADD COLUMN IF NOT EXISTS canal_contacto VARCHAR(20),
        ADD COLUMN IF NOT EXISTS twitter VARCHAR(100),
        ADD COLUMN IF NOT EXISTS direccion_publica VARCHAR(255),
        ADD COLUMN IF NOT EXISTS ciudad_publica VARCHAR(100);

      COMMENT ON COLUMN tiendas.canal_contacto IS 'Canal preferido: whatsapp | email | telefono | instagram.';
      COMMENT ON COLUMN tiendas.direccion_publica IS 'Dirección que se muestra al público (no la del depósito).';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE tiendas
        DROP COLUMN IF EXISTS ciudad_publica,
        DROP COLUMN IF EXISTS direccion_publica,
        DROP COLUMN IF EXISTS twitter,
        DROP COLUMN IF EXISTS canal_contacto,
        DROP COLUMN IF EXISTS nombre_contacto;
    `);
  },
};
