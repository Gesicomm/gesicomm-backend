const sequelize = require('../src/config/database');

async function migrate() {
  const transaction = await sequelize.transaction();
  try {
    console.log('--- Iniciando migración de LandingSecciones a arquitectura Enterprise ---');

    // 1. Agregar las nuevas columnas si no existen
    const columns = [
      'ADD COLUMN IF NOT EXISTS stable_id VARCHAR(40)',
      "ADD COLUMN IF NOT EXISTS page_type VARCHAR(30) NOT NULL DEFAULT 'landing'",
      'ADD COLUMN IF NOT EXISTS template_id VARCHAR(60)',
      'ADD COLUMN IF NOT EXISTS content_json JSONB',
      'ADD COLUMN IF NOT EXISTS settings_json JSONB',
      "ADD COLUMN IF NOT EXISTS responsive_json JSONB DEFAULT '{}'",
      `ADD COLUMN IF NOT EXISTS visibility_json JSONB DEFAULT '{"desktop":true,"tablet":true,"mobile":true}'`,
      "ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'published'",
      'ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1'
    ];

    for (const addCol of columns) {
      await sequelize.query(`ALTER TABLE landing_secciones ${addCol}`, { transaction });
    }
    console.log('Nuevas columnas agregadas.');

    // 2. Modificar tipo a VARCHAR(40) (eliminando la restricción de ENUM)
    await sequelize.query(`ALTER TABLE landing_secciones ALTER COLUMN tipo TYPE VARCHAR(40)`, { transaction });
    console.log('Columna tipo convertida a VARCHAR(40).');

    // 3. Poblar stable_id en filas existentes
    await sequelize.query(`UPDATE landing_secciones SET stable_id = 'legacy-' || id::text WHERE stable_id IS NULL`, { transaction });
    console.log('stable_id inicializado para filas legacy.');

    // 4. Copiar config_json y contenido_json a las nuevas columnas
    await sequelize.query(`
      UPDATE landing_secciones SET
        content_json = contenido_json,
        settings_json = config_json
      WHERE content_json IS NULL
    `, { transaction });
    console.log('Datos copiados de config_json/contenido_json a settings_json/content_json.');

    await transaction.commit();
    console.log('--- Migración completada exitosamente ---');
  } catch (error) {
    await transaction.rollback();
    console.error('--- Error en la migración, rollback realizado ---', error);
  } finally {
    process.exit(0);
  }
}

migrate();
