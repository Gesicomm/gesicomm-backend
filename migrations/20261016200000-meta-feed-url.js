'use strict';
module.exports = {
  async up(qi) {
    await qi.sequelize.transaction(async transaction => {
      const run = sql => qi.sequelize.query(sql, { transaction });
      await run(`CREATE TABLE IF NOT EXISTS meta_feeds (
        id SERIAL PRIMARY KEY, tienda_id INTEGER NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
        landing_id INTEGER NOT NULL UNIQUE REFERENCES landings(id) ON DELETE CASCADE,
        activo BOOLEAN NOT NULL DEFAULT FALSE,
        revision INTEGER NOT NULL DEFAULT 1, revision_generada INTEGER,
        archivo VARCHAR(255), generado_at TIMESTAMPTZ, descargado_at TIMESTAMPTZ,
        cantidad INTEGER NOT NULL DEFAULT 0, omitidos JSONB NOT NULL DEFAULT '[]', error VARCHAR(500),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      // Conserva los IDs que el Pixel ya usa. Cambiar un slug futuro no cambia
      // la identidad comercial ni invalida los enlaces históricos del feed.
      await run('ALTER TABLE productos ADD COLUMN IF NOT EXISTS meta_content_id VARCHAR(255)');
      await run("UPDATE productos SET meta_content_id = COALESCE(NULLIF(slug, ''), 'producto-' || id) WHERE meta_content_id IS NULL");
      await run(`CREATE OR REPLACE FUNCTION fijar_meta_content_id() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP = 'UPDATE' AND OLD.meta_content_id IS NOT NULL THEN
            NEW.meta_content_id := OLD.meta_content_id;
          ELSE
            NEW.meta_content_id := COALESCE(NULLIF(NEW.slug, ''), 'producto-' || NEW.id);
          END IF;
          RETURN NEW;
        END $$`);
      await run('DROP TRIGGER IF EXISTS productos_meta_content_id ON productos');
      await run('CREATE TRIGGER productos_meta_content_id BEFORE INSERT OR UPDATE ON productos FOR EACH ROW EXECUTE FUNCTION fijar_meta_content_id()');
      await run('CREATE INDEX IF NOT EXISTS productos_meta_content_id_idx ON productos(meta_content_id)');
    });
  },
  async down(qi) {
    await qi.sequelize.query('DROP TABLE IF EXISTS meta_feeds; DROP TRIGGER IF EXISTS productos_meta_content_id ON productos; DROP FUNCTION IF EXISTS fijar_meta_content_id(); DROP INDEX IF EXISTS productos_meta_content_id_idx; ALTER TABLE productos DROP COLUMN IF EXISTS meta_content_id');
  },
};
