'use strict';

/**
 * Dos campos de Mi Tienda pedidos el mismo día:
 *
 * - favicon_imagen / favicon_imagen_storage_key: ícono de la pestaña del
 *   navegador, separado del logo. Hasta ahora la pestaña usaba el logo y un
 *   logo con texto (ancho, con márgenes) quedaba ilegible a 16 px. NULL =
 *   sigue cayendo al logo como antes, así que no hace falta backfill. El
 *   archivo se guarda ya procesado (PNG cuadrado 192x192), por eso no lleva
 *   las columnas de tamaño/mime del logo.
 *
 * - mensaje_consulta_general: plantilla de WhatsApp para consultas que no
 *   son de un producto puntual (inicio, categorías, botones de contacto).
 *   mensaje_contacto queda como la plantilla de consulta de PRODUCTO.
 *   NULL = mensaje genérico por defecto en el front.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE tiendas
        ADD COLUMN IF NOT EXISTS favicon_imagen VARCHAR(700),
        ADD COLUMN IF NOT EXISTS favicon_imagen_storage_key VARCHAR(700),
        ADD COLUMN IF NOT EXISTS mensaje_consulta_general VARCHAR(300);

      COMMENT ON COLUMN tiendas.favicon_imagen IS 'URL pública del favicon (PNG 192x192 en R2). NULL = la pestaña usa el logo.';
      COMMENT ON COLUMN tiendas.mensaje_consulta_general IS 'Plantilla de WhatsApp para consultas generales (inicio, categorías). Soporta {url}.';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE tiendas
        DROP COLUMN IF EXISTS favicon_imagen,
        DROP COLUMN IF EXISTS favicon_imagen_storage_key,
        DROP COLUMN IF EXISTS mensaje_consulta_general;
    `);
  },
};
