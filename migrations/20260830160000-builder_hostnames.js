'use strict';

/**
 * Page Builder: cada página o funnel se publica en SU PROPIO HOSTNAME.
 *
 * Antes las páginas iban a colgar de un path compartido
 * (/p/<slug>, /f/<funnel>/<pagina>). El modelo real es otro: cada cosa
 * publicable tiene su propia dirección, y puede ser
 *
 *   un subdominio de la plataforma   calcula.gesicomm.com
 *                                    t2e.gesicomm.com
 *                                    somnix.gesicomm.com
 *   o un dominio propio del usuario  t2e.com.py
 *
 * builder_domains deja de ser "los dominios propios" y pasa a ser EL
 * REGISTRO DE HOSTNAMES: la única tabla que contesta "quién sirve este
 * host". Los dos casos viven acá porque para el resolvedor público son lo
 * mismo — un hostname que apunta a una página o a un funnel. Lo único que
 * cambia entre ellos es cómo se consigue el certificado:
 *
 *   subdominio      → no necesita nada. *.gesicomm.com ya tiene DNS
 *                     wildcard y certificado wildcard en el origen
 *                     (ver deploy/nginx/tiendas.gesicomm.com). Queda
 *                     activo al crearse.
 *   dominio_propio  → Cloudflare for SaaS (Custom Hostnames), exactamente
 *                     el mismo mecanismo que ya usa Tienda.dominio_propio
 *                     con services/cloudflare.service.js. Hay que
 *                     verificar con un TXT y esperar el certificado.
 *
 * Un target puede tener VARIOS hostnames (el subdominio de la plataforma
 * y el dominio propio apuntando a la misma página). `es_principal` marca
 * cuál es la URL canónica — la que va en og:url y en los links que genera
 * el sistema.
 *
 * ⚠️ EL NAMESPACE DE SUBDOMINIOS ES COMPARTIDO CON LAS TIENDAS.
 * calcula.gesicomm.com no puede existir si ya hay una tienda con
 * subdominio "calcula". Postgres no puede imponer una UNIQUE entre dos
 * tablas, así que eso lo valida utils/validarSubdominio.js consultando
 * las dos. Acá se guarda `subdominio` (la etiqueta sola, sin el dominio
 * base) justamente para que esa consulta sea directa.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.builder_domains RENAME COLUMN dominio TO hostname;

        ALTER TABLE public.builder_domains
          ADD COLUMN IF NOT EXISTS pagina_id   INTEGER
            REFERENCES public.builder_pages(id) ON DELETE CASCADE,
          ADD COLUMN IF NOT EXISTS tipo        VARCHAR(20) NOT NULL DEFAULT 'subdominio',
          ADD COLUMN IF NOT EXISTS subdominio  VARCHAR(63),
          ADD COLUMN IF NOT EXISTS es_principal BOOLEAN NOT NULL DEFAULT true;
      `, { transaction });

      // El funnel dejaba el hostname huérfano al borrarse (SET NULL). Un
      // hostname sin target no sirve para nada y encima bloquea el nombre.
      await queryInterface.sequelize.query(`
        ALTER TABLE public.builder_domains
          DROP CONSTRAINT IF EXISTS builder_domains_funnel_id_fkey;

        ALTER TABLE public.builder_domains
          ADD CONSTRAINT builder_domains_funnel_id_fkey
          FOREIGN KEY (funnel_id) REFERENCES public.builder_funnels(id) ON DELETE CASCADE;
      `, { transaction });

      await queryInterface.sequelize.query(`
        ALTER TABLE public.builder_domains
          ADD CONSTRAINT chk_builder_domains_tipo
            CHECK (tipo IN ('subdominio', 'dominio_propio'));

        -- Exactamente un target: o una página suelta, o un funnel. Nunca
        -- los dos, nunca ninguno.
        ALTER TABLE public.builder_domains
          ADD CONSTRAINT chk_builder_domains_target
            CHECK ((pagina_id IS NOT NULL)::int + (funnel_id IS NOT NULL)::int = 1);

        -- La etiqueta del subdominio solo tiene sentido (y es obligatoria)
        -- cuando el hostname es un subdominio de la plataforma.
        ALTER TABLE public.builder_domains
          ADD CONSTRAINT chk_builder_domains_subdominio
            CHECK (
              (tipo = 'subdominio'     AND subdominio IS NOT NULL) OR
              (tipo = 'dominio_propio' AND subdominio IS NULL)
            );
      `, { transaction });

      await queryInterface.sequelize.query(`
        -- La etiqueta, además del hostname completo: es lo que se compara
        -- contra tiendas.subdominio.
        CREATE UNIQUE INDEX IF NOT EXISTS uq_builder_domains_subdominio
          ON public.builder_domains (subdominio) WHERE subdominio IS NOT NULL;

        -- Una sola URL canónica por página y por funnel.
        CREATE UNIQUE INDEX IF NOT EXISTS uq_builder_domains_principal_pagina
          ON public.builder_domains (pagina_id) WHERE es_principal AND pagina_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_builder_domains_principal_funnel
          ON public.builder_domains (funnel_id) WHERE es_principal AND funnel_id IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_builder_domains_pagina
          ON public.builder_domains (pagina_id);
      `, { transaction });
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        DROP INDEX IF EXISTS public.uq_builder_domains_subdominio;
        DROP INDEX IF EXISTS public.uq_builder_domains_principal_pagina;
        DROP INDEX IF EXISTS public.uq_builder_domains_principal_funnel;
        DROP INDEX IF EXISTS public.idx_builder_domains_pagina;

        ALTER TABLE public.builder_domains
          DROP CONSTRAINT IF EXISTS chk_builder_domains_tipo,
          DROP CONSTRAINT IF EXISTS chk_builder_domains_target,
          DROP CONSTRAINT IF EXISTS chk_builder_domains_subdominio;

        ALTER TABLE public.builder_domains
          DROP COLUMN IF EXISTS pagina_id,
          DROP COLUMN IF EXISTS tipo,
          DROP COLUMN IF EXISTS subdominio,
          DROP COLUMN IF EXISTS es_principal;

        ALTER TABLE public.builder_domains
          DROP CONSTRAINT IF EXISTS builder_domains_funnel_id_fkey;
        ALTER TABLE public.builder_domains
          ADD CONSTRAINT builder_domains_funnel_id_fkey
          FOREIGN KEY (funnel_id) REFERENCES public.builder_funnels(id) ON DELETE SET NULL;

        ALTER TABLE public.builder_domains RENAME COLUMN hostname TO dominio;
      `, { transaction });
    });
  },
};
