'use strict';

/**
 * Permite que un usuario tenga más de una Tienda: quita la restricción
 * única sobre tiendas.usuario_id y deja un índice normal (no único) para
 * no perder el lookup por dueño. Aditiva y no destructiva: ninguna fila
 * cambia, cada usuario que ya tenía una tienda sigue teniendo exactamente
 * esa.
 *
 * La tabla `tiendas` no tiene una migración de creación en este repo (se
 * sincronizó en algún momento con sequelize.sync()), así que no se puede
 * asumir el nombre exacto del constraint/índice único — se lo busca en el
 * catálogo de Postgres en vez de adivinarlo.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        DO $$
        DECLARE
          r RECORD;
        BEGIN
          FOR r IN
            SELECT con.conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
              AND rel.relname = 'tiendas'
              AND con.contype = 'u'
              AND (
                SELECT array_agg(attname::text ORDER BY attnum)
                FROM pg_attribute
                WHERE attrelid = rel.oid AND attnum = ANY(con.conkey)
              ) = ARRAY['usuario_id']
          LOOP
            EXECUTE format('ALTER TABLE public.tiendas DROP CONSTRAINT %I', r.conname);
          END LOOP;

          FOR r IN
            SELECT indexname FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = 'tiendas'
              AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%(usuario_id)%'
          LOOP
            EXECUTE format('DROP INDEX IF EXISTS %I', r.indexname);
          END LOOP;
        END $$;

        CREATE INDEX IF NOT EXISTS tiendas_usuario_id_idx ON public.tiendas (usuario_id);
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        DROP INDEX IF EXISTS tiendas_usuario_id_idx;
        ALTER TABLE public.tiendas
          ADD CONSTRAINT tiendas_usuario_id_unique UNIQUE (usuario_id);
      `, { transaction });
    });
  },
};
