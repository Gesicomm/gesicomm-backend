'use strict';

/**
 * Dominios propios sin Cloudflare — PARTE 2 de 2: lo que se borra.
 *
 * ⚠️ CORRER SOLO DESPUÉS de que el código nuevo esté desplegado. Estas
 * columnas las lee el código viejo; el nuevo ya no las mira. Ver el
 * encabezado de 20260908210000-dominios_propios_habilitado.js para la
 * secuencia completa y por qué está partida en dos.
 *
 * Los dominios propios ya no se registran en ningún proveedor: el cliente
 * apunta un registro A a la IP del VPS, el backend verifica resolviendo su
 * DNS y Caddy emite el certificado solo (src/utils/dominios.js). Estas
 * cuatro columnas eran todo lo que hacía falta para hablar con Cloudflare
 * for SaaS y quedaron sin uso.
 *
 * ⚠️ El `down` recrea las columnas, pero NO los datos. Antes de borrarlas,
 * el único custom hostname que existía en la zona era
 * gesis.cogymtraining.com, id 1e83e196-f3d2-44c2-ac31-1f32a4cf0564: queda
 * anotado acá porque después de esto la única forma de darlo de baja en
 * Cloudflare es desde su panel.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.tiendas
          DROP COLUMN IF EXISTS dominio_propio_cf_hostname_id;

        ALTER TABLE public.builder_domains
          DROP COLUMN IF EXISTS cf_hostname_id,
          DROP COLUMN IF EXISTS verificacion_txt_nombre,
          DROP COLUMN IF EXISTS verificacion_txt_valor;
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Recrea la forma de la tabla, no el contenido.
      await queryInterface.sequelize.query(`
        ALTER TABLE public.tiendas
          ADD COLUMN IF NOT EXISTS dominio_propio_cf_hostname_id VARCHAR(100);

        ALTER TABLE public.builder_domains
          ADD COLUMN IF NOT EXISTS cf_hostname_id          VARCHAR(64),
          ADD COLUMN IF NOT EXISTS verificacion_txt_nombre VARCHAR(255),
          ADD COLUMN IF NOT EXISTS verificacion_txt_valor  VARCHAR(255);
      `, { transaction });
    });
  },
};
