'use strict';

/**
 * Dominios propios sin Cloudflare — PARTE 1 de 2: lo que se agrega.
 *
 * Va SEPARADA del borrado de las columnas viejas (parte 2) porque el
 * despliegue es automático: el workflow de GitHub Actions hace
 * `git reset --hard` + `docker compose up -d --build backend` con cada push
 * a main, y NO corre migraciones. Con una sola migración que agregara y
 * borrara a la vez no hay ningún orden que funcione:
 *
 *   migrar y después desplegar → el código viejo sigue vivo un rato pidiendo
 *                                columnas que ya no existen
 *   desplegar y después migrar → el código nuevo arranca pidiendo columnas
 *                                que todavía no existen
 *
 * Partido en dos, la secuencia es segura de punta a punta:
 *
 *   1. esta migración   (el código viejo ignora columnas de más)
 *   2. push a main      (el código nuevo ya tiene lo que necesita)
 *   3. la parte 2       (el código nuevo ya no mira las columnas viejas)
 *
 * Qué agrega: la única bandera del ciclo de vida de un dominio que se
 * guarda. Los otros estados —pendiente, verificado, activo— se calculan al
 * vuelo consultando el DNS y el HTTPS del dominio, así que persistirlos
 * sería tener dos fuentes de verdad: quedarían mintiendo apenas el cliente
 * tocara su DNS. `deshabilitado` es distinto: es una decisión nuestra, no
 * un hecho del mundo, y por eso es lo único que hay que recordar.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.tiendas
          ADD COLUMN IF NOT EXISTS dominio_propio_habilitado BOOLEAN NOT NULL DEFAULT true;

        COMMENT ON COLUMN public.tiendas.dominio_propio_habilitado IS
          'false = el dominio queda cargado pero no se sirve ni se le emite certificado. Los estados pendiente/verificado/activo NO se guardan: se calculan contra el DNS real.';
      `, { transaction });

      await queryInterface.sequelize.query(`
        ALTER TABLE public.builder_domains
          ADD COLUMN IF NOT EXISTS habilitado BOOLEAN NOT NULL DEFAULT true;

        COMMENT ON COLUMN public.builder_domains.habilitado IS
          'false = el hostname queda cargado pero no resuelve ni se le emite certificado.';
      `, { transaction });

      // Los dominios propios marcados como verificados lo fueron contra
      // Cloudflare, no contra nuestro DNS: bajo la arquitectura nueva
      // todavía no apuntan acá. Se los devuelve a pendiente para que el
      // cliente cargue su registro A y vuelva a verificar, en lugar de
      // dejarlos diciendo que están conectados cuando no lo están.
      await queryInterface.sequelize.query(`
        UPDATE public.tiendas
           SET dominio_propio_verificado = false
         WHERE dominio_propio IS NOT NULL
           AND dominio_propio_verificado = true;

        UPDATE public.builder_domains
           SET estado_verificacion = 'pendiente',
               estado_ssl          = 'pendiente'
         WHERE tipo = 'dominio_propio'
           AND estado_verificacion <> 'pendiente';
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // No se revierte el reseteo de verificados: no sabemos cuáles lo
      // estaban antes, y volver a marcarlos sería peor que dejarlos
      // pendientes.
      await queryInterface.sequelize.query(`
        ALTER TABLE public.tiendas        DROP COLUMN IF EXISTS dominio_propio_habilitado;
        ALTER TABLE public.builder_domains DROP COLUMN IF EXISTS habilitado;
      `, { transaction });
    });
  },
};
