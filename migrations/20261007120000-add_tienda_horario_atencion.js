'use strict';

/**
 * Horario de atención de la Tienda: texto libre (ej: "Lunes a viernes de
 * 9 a 18 horas") que se muestra como default en el footer de las landings
 * de "Lienzo en blanco" — mismo patrón que direccion_publica/ciudad_publica
 * (20260924150000): lo carga una vez en Configurar tienda → Contacto y
 * landing.service.js lo usa como fallback cuando la landing no trae el suyo.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE tiendas
        ADD COLUMN IF NOT EXISTS horario_atencion VARCHAR(150);

      COMMENT ON COLUMN tiendas.horario_atencion IS 'Texto libre, ej: Lunes a viernes de 9 a 18 horas.';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE tiendas
        DROP COLUMN IF EXISTS horario_atencion;
    `);
  },
};
