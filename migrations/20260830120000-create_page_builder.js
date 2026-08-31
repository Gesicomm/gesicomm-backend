'use strict';

/**
 * Page Builder — tablas del módulo de páginas y funnels de código.
 *
 * ⚠️ OJO CON EL NOMBRE: en Gesicomm ya existe "Funnel" y significa OTRA
 * COSA — es una fila de la tabla `landings` con tipo_pagina='funnel', o
 * sea un embudo de UN producto con estructura rígida en React, donde el
 * comercio solo edita contenido (ver src/models/Funnel.js y
 * src/services/funnel.service.js). Eso no se toca.
 *
 * `builder_funnels` es un concepto distinto: una SECUENCIA ORDENADA DE
 * PÁGINAS de código (HTML/CSS/JS) escritas o pegadas por el usuario. Por
 * eso todo este módulo vive bajo el prefijo `builder_`, sin excepción.
 *
 * Estructura:
 *
 *   builder_projects            contenedor de trabajo, NO aparece en ninguna URL
 *     ├── builder_pages         funnel_id NULL  → /p/<slug>
 *     └── builder_funnels       → /f/<slug>
 *           └── builder_pages   funnel_id = X   → /f/<funnel>/<pagina>
 *                 └── builder_funnel_pages      orden + página de entrada
 *
 *   builder_page_versions       versiones inmutables de cada página
 *   builder_domains             dominios propios (preparación, reusa Cloudflare)
 *
 * Decisiones codificadas acá que conviene no deshacer sin leer antes
 * PLAN-PAGE-FUNNEL-BUILDER.md:
 *
 * 1) El ORDEN y la PÁGINA DE ENTRADA viven SOLO en builder_funnel_pages.
 *    builder_pages no tiene `posicion` ni `es_entrada` a propósito: dos
 *    fuentes de verdad para el mismo orden se desincronizan siempre.
 *
 * 2) builder_pages.funnel_id existe únicamente para poder tener los dos
 *    índices parciales de slug (una página suelta es única por tienda; una
 *    página de funnel, única dentro de su funnel — así dos funnels pueden
 *    tener cada uno su página "landing"). La FK COMPUESTA de
 *    builder_funnel_pages (pagina_id, funnel_id) → builder_pages (id,
 *    funnel_id) es lo que impide, a nivel base, que ese funnel_id y el de
 *    la tabla puente diverjan.
 *
 * 3) UNIQUE (pagina_id) en builder_funnel_pages limita una página a UN
 *    funnel. Es lo único que hay que quitar el día que se quiera
 *    reutilizar una misma página en varios funnels.
 *
 * 4) Sin tipos ENUM de Postgres: VARCHAR + CHECK, igual que el resto del
 *    proyecto (ver el comentario de LandingTemplate.kind).
 */

/**
 * Todo el up() va en UNA transacción. Postgres soporta DDL transaccional,
 * así que si cualquiera de las sentencias falla no queda ninguna tabla a
 * medio crear: o entran las seis o no entra nada. Importa porque esta
 * migración se corre contra la base real.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
    // ── Proyectos ────────────────────────────────────────────────────
    // Contenedor. Sin columna `tipo` y sin `slug`: un proyecto agrupa
    // páginas y funnels, pero no se publica ni aparece en ninguna URL.
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS public.builder_projects (
        id           SERIAL PRIMARY KEY,
        inquilino_id INTEGER NOT NULL REFERENCES public.inquilinos(id),
        tienda_id    INTEGER NOT NULL REFERENCES public.tiendas(id) ON DELETE CASCADE,
        usuario_id   INTEGER REFERENCES public.usuarios(id) ON DELETE SET NULL,
        nombre       VARCHAR(150) NOT NULL,
        descripcion  TEXT,
        estado       VARCHAR(15) NOT NULL DEFAULT 'draft',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_builder_projects_estado
          CHECK (estado IN ('draft', 'published', 'unpublished'))
      );

      CREATE INDEX IF NOT EXISTS idx_builder_projects_tienda
        ON public.builder_projects (tienda_id);
      CREATE INDEX IF NOT EXISTS idx_builder_projects_inquilino
        ON public.builder_projects (inquilino_id);
    `, { transaction });

    // ── Funnels ──────────────────────────────────────────────────────
    // inquilino_id/tienda_id desnormalizados: la ruta pública resuelve la
    // tienda por hostname y busca el funnel por (tienda_id, slug) sin JOIN.
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS public.builder_funnels (
        id           SERIAL PRIMARY KEY,
        proyecto_id  INTEGER NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,
        inquilino_id INTEGER NOT NULL REFERENCES public.inquilinos(id),
        tienda_id    INTEGER NOT NULL REFERENCES public.tiendas(id) ON DELETE CASCADE,
        nombre       VARCHAR(150) NOT NULL,
        slug         VARCHAR(120) NOT NULL,
        descripcion  TEXT,
        estado       VARCHAR(15) NOT NULL DEFAULT 'draft',
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_builder_funnels_tienda_slug UNIQUE (tienda_id, slug),
        CONSTRAINT chk_builder_funnels_estado
          CHECK (estado IN ('draft', 'published', 'unpublished')),
        CONSTRAINT chk_builder_funnels_slug
          CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$')
      );

      CREATE INDEX IF NOT EXISTS idx_builder_funnels_proyecto
        ON public.builder_funnels (proyecto_id);
    `, { transaction });

    // ── Páginas ──────────────────────────────────────────────────────
    // funnel_id NULL = página suelta (/p/<slug>). Las FK a
    // builder_page_versions se agregan más abajo: son circulares.
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS public.builder_pages (
        id                   SERIAL PRIMARY KEY,
        proyecto_id          INTEGER NOT NULL REFERENCES public.builder_projects(id) ON DELETE CASCADE,
        funnel_id            INTEGER REFERENCES public.builder_funnels(id) ON DELETE CASCADE,
        inquilino_id         INTEGER NOT NULL REFERENCES public.inquilinos(id),
        tienda_id            INTEGER NOT NULL REFERENCES public.tiendas(id) ON DELETE CASCADE,
        nombre               VARCHAR(150) NOT NULL,
        slug                 VARCHAR(120) NOT NULL,
        estado               VARCHAR(15) NOT NULL DEFAULT 'draft',
        seo_titulo           VARCHAR(160),
        seo_descripcion      VARCHAR(320),
        og_titulo            VARCHAR(160),
        og_descripcion       VARCHAR(320),
        og_imagen            VARCHAR(255),
        favicon_url          VARCHAR(255),
        destino_cta          JSONB,
        draft_version_id     INTEGER,
        published_version_id INTEGER,
        published_at         TIMESTAMPTZ,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_builder_pages_estado
          CHECK (estado IN ('draft', 'published', 'unpublished')),
        CONSTRAINT chk_builder_pages_slug
          CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'),
        -- Destino de builder_funnel_pages.(pagina_id, funnel_id). Sin esta
        -- UNIQUE, la FK compuesta de la tabla puente no se puede declarar.
        CONSTRAINT uq_builder_pages_id_funnel UNIQUE (id, funnel_id)
      );

      -- Página suelta: el slug ocupa /p/<slug>, único por tienda.
      CREATE UNIQUE INDEX IF NOT EXISTS uq_builder_pages_suelta_slug
        ON public.builder_pages (tienda_id, slug) WHERE funnel_id IS NULL;

      -- Página de funnel: el slug es único DENTRO del funnel, así dos
      -- funnels distintos pueden tener cada uno su página "landing".
      CREATE UNIQUE INDEX IF NOT EXISTS uq_builder_pages_funnel_slug
        ON public.builder_pages (funnel_id, slug) WHERE funnel_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_builder_pages_proyecto
        ON public.builder_pages (proyecto_id);
      CREATE INDEX IF NOT EXISTS idx_builder_pages_tienda
        ON public.builder_pages (tienda_id);
    `, { transaction });

    // ── Versiones (inmutables) ───────────────────────────────────────
    // Una fila con estado='published' NUNCA se actualiza, salvo para
    // pasar a 'archived' cuando se publica otra. Lo hace cumplir
    // builderPageVersion.service.js; acá solo está el CHECK del dominio.
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS public.builder_page_versions (
        id           SERIAL PRIMARY KEY,
        pagina_id    INTEGER NOT NULL REFERENCES public.builder_pages(id) ON DELETE CASCADE,
        version      INTEGER NOT NULL,
        html         TEXT NOT NULL DEFAULT '',
        css          TEXT NOT NULL DEFAULT '',
        js           TEXT NOT NULL DEFAULT '',
        estado       VARCHAR(15) NOT NULL DEFAULT 'draft',
        nota         VARCHAR(200),
        creado_por   INTEGER REFERENCES public.usuarios(id) ON DELETE SET NULL,
        bytes        INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        published_at TIMESTAMPTZ,
        CONSTRAINT uq_builder_page_versions_pagina_version UNIQUE (pagina_id, version),
        CONSTRAINT chk_builder_page_versions_estado
          CHECK (estado IN ('draft', 'published', 'archived')),
        CONSTRAINT chk_builder_page_versions_version CHECK (version >= 1)
      );

      CREATE INDEX IF NOT EXISTS idx_builder_page_versions_pagina
        ON public.builder_page_versions (pagina_id, created_at DESC);
    `, { transaction });

    // ── FK circulares página ↔ versión ───────────────────────────────
    // ON DELETE SET NULL y no CASCADE: borrar una versión no puede
    // llevarse puesta la página. La poda de versiones nunca toca la
    // publicada ni el borrador, así que en la práctica no se dispara.
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_builder_pages_draft_version') THEN
          ALTER TABLE public.builder_pages
            ADD CONSTRAINT fk_builder_pages_draft_version
            FOREIGN KEY (draft_version_id)
            REFERENCES public.builder_page_versions(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_builder_pages_published_version') THEN
          ALTER TABLE public.builder_pages
            ADD CONSTRAINT fk_builder_pages_published_version
            FOREIGN KEY (published_version_id)
            REFERENCES public.builder_page_versions(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `, { transaction });

    // ── Orden y entrada del funnel ───────────────────────────────────
    // Única fuente de verdad del orden. La UNIQUE de posicion es
    // DEFERRABLE para poder reindexar 1..N dentro de una transacción sin
    // pasar por posiciones temporales inválidas.
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS public.builder_funnel_pages (
        id         SERIAL PRIMARY KEY,
        funnel_id  INTEGER NOT NULL REFERENCES public.builder_funnels(id) ON DELETE CASCADE,
        pagina_id  INTEGER NOT NULL,
        posicion   INTEGER NOT NULL,
        es_entrada BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        -- MVP: una página pertenece a UN solo funnel. Quitar esta línea
        -- es todo lo que hace falta para permitir reutilizarla en varios.
        CONSTRAINT uq_builder_funnel_pages_pagina UNIQUE (pagina_id),
        CONSTRAINT uq_builder_funnel_pages_posicion
          UNIQUE (funnel_id, posicion) DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT chk_builder_funnel_pages_posicion CHECK (posicion >= 1),
        -- Sin ON UPDATE CASCADE a propósito: si alguien cambia
        -- builder_pages.funnel_id con la fila puente todavía viva, tiene
        -- que fallar. Sacar una página de un funnel es borrar el paso
        -- primero y recién después poner funnel_id en NULL.
        CONSTRAINT fk_builder_funnel_pages_pagina
          FOREIGN KEY (pagina_id, funnel_id)
          REFERENCES public.builder_pages (id, funnel_id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_builder_funnel_pages_entrada
        ON public.builder_funnel_pages (funnel_id) WHERE es_entrada;
    `, { transaction });

    // ── Dominios propios (preparación) ───────────────────────────────
    // Extiende a N dominios por tienda lo que hoy hace Tienda.dominio_propio*
    // con services/cloudflare.service.js. No se agrega ninguna integración
    // DNS nueva: cf_hostname_id es el mismo ID de Cloudflare for SaaS.
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS public.builder_domains (
        id                      SERIAL PRIMARY KEY,
        inquilino_id            INTEGER NOT NULL REFERENCES public.inquilinos(id),
        tienda_id               INTEGER NOT NULL REFERENCES public.tiendas(id) ON DELETE CASCADE,
        funnel_id               INTEGER REFERENCES public.builder_funnels(id) ON DELETE SET NULL,
        dominio                 VARCHAR(255) NOT NULL,
        estado_verificacion     VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        estado_ssl              VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        cf_hostname_id          VARCHAR(64),
        verificacion_txt_nombre VARCHAR(255),
        verificacion_txt_valor  VARCHAR(255),
        ultimo_chequeo_at       TIMESTAMPTZ,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_builder_domains_dominio UNIQUE (dominio),
        CONSTRAINT chk_builder_domains_verificacion
          CHECK (estado_verificacion IN ('pendiente', 'verificando', 'verificado', 'error')),
        CONSTRAINT chk_builder_domains_ssl
          CHECK (estado_ssl IN ('pendiente', 'emitiendo', 'activo', 'error'))
      );

      CREATE INDEX IF NOT EXISTS idx_builder_domains_tienda
        ON public.builder_domains (tienda_id);
    `, { transaction });
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
    // Orden inverso. CASCADE se lleva puestas las FK circulares sin tener
    // que soltarlas a mano.
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS public.builder_domains CASCADE;
      DROP TABLE IF EXISTS public.builder_funnel_pages CASCADE;
      DROP TABLE IF EXISTS public.builder_page_versions CASCADE;
      DROP TABLE IF EXISTS public.builder_pages CASCADE;
      DROP TABLE IF EXISTS public.builder_funnels CASCADE;
      DROP TABLE IF EXISTS public.builder_projects CASCADE;
    `, { transaction });
    });
  },
};
