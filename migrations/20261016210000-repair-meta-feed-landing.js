'use strict';

/**
 * Forward-only compatibility with the first feed schema (one row per shop).
 * CREATE TABLE IF NOT EXISTS in the initial migration cannot add columns to
 * an existing table. Keep this separate so SequelizeMeta can track the fix.
 */
module.exports = {
  async up(qi) {
    await qi.sequelize.transaction(async transaction => {
      const run = sql => qi.sequelize.query(sql, { transaction });
      await run('ALTER TABLE meta_feeds ADD COLUMN IF NOT EXISTS landing_id INTEGER REFERENCES landings(id) ON DELETE CASCADE');
      // Only the historical home landing is an unambiguous source. Preserve
      // unmatched records, paused, rather than deleting or guessing a landing.
      await run(`UPDATE meta_feeds AS f SET
        landing_id = l.id, archivo = NULL, generado_at = NULL,
        revision_generada = NULL, revision = f.revision + 1
        FROM landings AS l
        WHERE f.landing_id IS NULL AND l.tienda_id = f.tienda_id AND l.es_home = TRUE
          AND l.id = (SELECT MIN(h.id) FROM landings h WHERE h.tienda_id = f.tienda_id AND h.es_home = TRUE)`);
      await run(`UPDATE meta_feeds SET activo = FALSE,
        error = 'Esta configuración anterior no tiene una landing de inicio. Prepará el feed desde Productos de la landing correspondiente.'
        WHERE landing_id IS NULL`);
      // Older versions made tienda_id UNIQUE; now each shop may have several
      // independent landing feeds. Drop only that single-column constraint.
      await run(`DO $$ DECLARE c RECORD; BEGIN
        FOR c IN SELECT conname FROM pg_constraint
          WHERE conrelid = 'meta_feeds'::regclass AND contype = 'u'
            AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
              WHERE attrelid = 'meta_feeds'::regclass AND attname = 'tienda_id')]::smallint[]
        LOOP EXECUTE format('ALTER TABLE meta_feeds DROP CONSTRAINT %I', c.conname); END LOOP;
      END $$`);
      await run('CREATE UNIQUE INDEX IF NOT EXISTS meta_feeds_landing_id_unique ON meta_feeds(landing_id)');
      await run('CREATE INDEX IF NOT EXISTS meta_feeds_tienda_idx ON meta_feeds(tienda_id)');
      await run(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM meta_feeds WHERE landing_id IS NULL) THEN
          ALTER TABLE meta_feeds ALTER COLUMN landing_id SET NOT NULL;
        END IF;
      END $$`);
    });
  },
  async down() {
    // Preserving the column and associations is safer than collapsing several
    // landing feeds back into one shop feed. No destructive automatic rollback.
  },
};
