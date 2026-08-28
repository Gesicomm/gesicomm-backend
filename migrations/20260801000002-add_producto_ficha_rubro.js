'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE productos
        ADD COLUMN IF NOT EXISTS ficha_rubro VARCHAR(40),
        ADD COLUMN IF NOT EXISTS ficha_datos JSONB NOT NULL DEFAULT '{}'::jsonb;

      COMMENT ON COLUMN productos.ficha_rubro IS
        'Qué juego de campos usa la ficha de este producto: "suplementos", "tecnologia" o NULL (genérico). Decide qué pestaña de campos muestra Mis Productos y de dónde saca los datos la página de producto de la landing.';
      COMMENT ON COLUMN productos.ficha_datos IS
        'Campos propios del rubro, con la forma que define el frontend. suplementos: {ingredientes:[{nombre,dosis,texto}], modo_uso}. tecnologia: {especificaciones:[{clave,valor}], en_la_caja:[texto], comparativa:[{caracteristica,nosotros,otros}]}. {} = nada cargado.';
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE productos
        DROP COLUMN IF EXISTS ficha_rubro,
        DROP COLUMN IF EXISTS ficha_datos;
    `);
  }
};
