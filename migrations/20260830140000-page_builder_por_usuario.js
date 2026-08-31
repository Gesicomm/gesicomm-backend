'use strict';

/**
 * Page Builder: las páginas dejan de depender de la Tienda.
 *
 * CORRECCIÓN DE DISEÑO sobre 20260830120000-create_page_builder.js.
 * Ahí las páginas colgaban de una Tienda, copiando el modelo de las
 * landings. Está mal para este módulo: una página del Page Builder no
 * tiene NADA que ver con una tienda. Es una página suelta, de un usuario,
 * sin dependencias — puede existir aunque su dueño no tenga tienda
 * ninguna (que es justamente el caso de todos los administradores).
 *
 * Qué cambia:
 *
 *   tienda_id  ELIMINADA de projects, funnels, pages y domains.
 *   usuario_id ES EL DUEÑO: NOT NULL, ON DELETE CASCADE, y el filtro de
 *              toda consulta. Antes era solo un dato de autoría.
 *   inquilino_id se conserva: es la convención de todas las tablas del
 *              proyecto y sirve para reportes a nivel inquilino, pero NO
 *              es el control de acceso de este módulo.
 *
 * Consecuencia sobre las URLs: sin tienda no hay hostname que resuelva el
 * dueño, así que el slug pasa a ser ÚNICO GLOBAL en lugar de único por
 * tienda, y las páginas se sirven desde un host propio del builder
 * (pages.gesicomm.com/p/<slug>) en vez de colgar del subdominio de una
 * tienda. Ver PLAN-PAGE-FUNNEL-BUILDER.md §4.
 *
 * Se corre como migración hacia adelante y no rehaciendo la anterior
 * porque la anterior ya está aplicada. Las tablas estaban vacías (el
 * módulo todavía no tiene API), así que agregar columnas NOT NULL y
 * cambiar la unicidad de los slugs no puede romper ninguna fila.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Al dropear una columna, Postgres se lleva solos los índices y las
      // FK que la incluyen — no hace falta soltarlos a mano.
      // uq_builder_pages_id_funnel (id, funnel_id) NO incluye tienda_id,
      // así que sobrevive: la FK compuesta de builder_funnel_pages sigue
      // en pie.
      await queryInterface.sequelize.query(`
        ALTER TABLE public.builder_projects DROP COLUMN IF EXISTS tienda_id;
        ALTER TABLE public.builder_funnels  DROP COLUMN IF EXISTS tienda_id;
        ALTER TABLE public.builder_pages    DROP COLUMN IF EXISTS tienda_id;
        ALTER TABLE public.builder_domains  DROP COLUMN IF EXISTS tienda_id;
      `, { transaction });

      // usuario_id pasa de "autoría opcional" a "dueño". En projects ya
      // existía como nullable con ON DELETE SET NULL: se rehace la FK.
      await queryInterface.sequelize.query(`
        ALTER TABLE public.builder_projects
          DROP CONSTRAINT IF EXISTS builder_projects_usuario_id_fkey;

        ALTER TABLE public.builder_projects
          ALTER COLUMN usuario_id SET NOT NULL;

        ALTER TABLE public.builder_projects
          ADD CONSTRAINT builder_projects_usuario_id_fkey
          FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;

        ALTER TABLE public.builder_funnels
          ADD COLUMN IF NOT EXISTS usuario_id INTEGER NOT NULL
          REFERENCES public.usuarios(id) ON DELETE CASCADE;

        ALTER TABLE public.builder_pages
          ADD COLUMN IF NOT EXISTS usuario_id INTEGER NOT NULL
          REFERENCES public.usuarios(id) ON DELETE CASCADE;

        ALTER TABLE public.builder_domains
          ADD COLUMN IF NOT EXISTS usuario_id INTEGER NOT NULL
          REFERENCES public.usuarios(id) ON DELETE CASCADE;
      `, { transaction });

      // Sin tienda que aísle un espacio de nombres del otro, el slug de
      // una página suelta y el de un funnel son únicos GLOBALES: los dos
      // definen un path en el mismo host del builder. El slug de una
      // página DENTRO de un funnel sigue siendo único por funnel — por
      // eso dos funnels pueden tener cada uno su "landing".
      await queryInterface.sequelize.query(`
        DROP INDEX IF EXISTS public.uq_builder_pages_suelta_slug;

        CREATE UNIQUE INDEX IF NOT EXISTS uq_builder_pages_suelta_slug
          ON public.builder_pages (slug) WHERE funnel_id IS NULL;

        CREATE UNIQUE INDEX IF NOT EXISTS uq_builder_funnels_slug
          ON public.builder_funnels (slug);

        CREATE INDEX IF NOT EXISTS idx_builder_projects_usuario
          ON public.builder_projects (usuario_id);
        CREATE INDEX IF NOT EXISTS idx_builder_funnels_usuario
          ON public.builder_funnels (usuario_id);
        CREATE INDEX IF NOT EXISTS idx_builder_pages_usuario
          ON public.builder_pages (usuario_id);
        CREATE INDEX IF NOT EXISTS idx_builder_domains_usuario
          ON public.builder_domains (usuario_id);
      `, { transaction });
    });
  },

  async down(queryInterface, Sequelize) {
    // Vuelve al modelo por tienda. Solo tiene sentido con las tablas
    // vacías: no hay forma de adivinar a qué tienda pertenecía una página
    // que se creó sin tienda.
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        DROP INDEX IF EXISTS public.uq_builder_funnels_slug;
        DROP INDEX IF EXISTS public.uq_builder_pages_suelta_slug;
        DROP INDEX IF EXISTS public.idx_builder_projects_usuario;
        DROP INDEX IF EXISTS public.idx_builder_funnels_usuario;
        DROP INDEX IF EXISTS public.idx_builder_pages_usuario;
        DROP INDEX IF EXISTS public.idx_builder_domains_usuario;

        ALTER TABLE public.builder_funnels DROP COLUMN IF EXISTS usuario_id;
        ALTER TABLE public.builder_pages   DROP COLUMN IF EXISTS usuario_id;
        ALTER TABLE public.builder_domains DROP COLUMN IF EXISTS usuario_id;

        ALTER TABLE public.builder_projects
          DROP CONSTRAINT IF EXISTS builder_projects_usuario_id_fkey;
        ALTER TABLE public.builder_projects ALTER COLUMN usuario_id DROP NOT NULL;
        ALTER TABLE public.builder_projects
          ADD CONSTRAINT builder_projects_usuario_id_fkey
          FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;

        ALTER TABLE public.builder_projects
          ADD COLUMN IF NOT EXISTS tienda_id INTEGER REFERENCES public.tiendas(id) ON DELETE CASCADE;
        ALTER TABLE public.builder_funnels
          ADD COLUMN IF NOT EXISTS tienda_id INTEGER REFERENCES public.tiendas(id) ON DELETE CASCADE;
        ALTER TABLE public.builder_pages
          ADD COLUMN IF NOT EXISTS tienda_id INTEGER REFERENCES public.tiendas(id) ON DELETE CASCADE;
        ALTER TABLE public.builder_domains
          ADD COLUMN IF NOT EXISTS tienda_id INTEGER REFERENCES public.tiendas(id) ON DELETE CASCADE;

        CREATE UNIQUE INDEX IF NOT EXISTS uq_builder_pages_suelta_slug
          ON public.builder_pages (tienda_id, slug) WHERE funnel_id IS NULL;
      `, { transaction });
    });
  },
};
