'use strict';

/**
 * Dueño del combo. Hasta ahora producto_combos solo tenía inquilino_id, y
 * como hay un único inquilino, cualquier combo que armaba un usuario le
 * aparecía a todos (Mis combos, vitrina). Mismo criterio que
 * productos.creado_por.
 *
 * Sin backfill: los combos anteriores quedan en NULL y solo los ve el
 * administrador (decisión del 2026-09-24).
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE producto_combos
        ADD COLUMN IF NOT EXISTS creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS producto_combos_creado_por ON producto_combos (creado_por);

      COMMENT ON COLUMN producto_combos.creado_por IS 'Usuario que armó el combo. NULL = combo anterior a 2026-09-24, solo visible para el administrador.';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS producto_combos_creado_por;
      ALTER TABLE producto_combos DROP COLUMN IF EXISTS creado_por;
    `);
  },
};
