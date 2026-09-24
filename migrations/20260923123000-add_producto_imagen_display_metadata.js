'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE producto_imagenes
        ADD COLUMN IF NOT EXISTS original_url VARCHAR(700),
        ADD COLUMN IF NOT EXISTS original_storage_key VARCHAR(700),
        ADD COLUMN IF NOT EXISTS visual_modo VARCHAR(20) NOT NULL DEFAULT 'contain',
        ADD COLUMN IF NOT EXISTS focal_x NUMERIC(5,2) NOT NULL DEFAULT 50,
        ADD COLUMN IF NOT EXISTS focal_y NUMERIC(5,2) NOT NULL DEFAULT 50,
        ADD COLUMN IF NOT EXISTS optimizacion_json JSONB;

      COMMENT ON COLUMN producto_imagenes.original_url IS
        'URL del archivo original subido por el usuario. La galería pública usa url/storage_key optimizada.';
      COMMENT ON COLUMN producto_imagenes.original_storage_key IS
        'Key R2 del original. Permite conservarlo intacto y borrar ambos archivos juntos.';
      COMMENT ON COLUMN producto_imagenes.visual_modo IS
        'Modo de galería: contain = mostrar completa, cover = rellenar marco.';
      COMMENT ON COLUMN producto_imagenes.focal_x IS
        'Punto focal horizontal en porcentaje para object-position.';
      COMMENT ON COLUMN producto_imagenes.focal_y IS
        'Punto focal vertical en porcentaje para object-position.';
      COMMENT ON COLUMN producto_imagenes.optimizacion_json IS
        'Metadata del procesamiento automático: dimensiones originales, recorte y versión optimizada.';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE producto_imagenes
        DROP COLUMN IF EXISTS optimizacion_json,
        DROP COLUMN IF EXISTS focal_y,
        DROP COLUMN IF EXISTS focal_x,
        DROP COLUMN IF EXISTS visual_modo,
        DROP COLUMN IF EXISTS original_storage_key,
        DROP COLUMN IF EXISTS original_url;
    `);
  },
};
