const db = require('./src/models');

async function check() {
  try {
    const res = await db.sequelize.query(`
      SELECT table_name, column_name, data_type, udt_name 
      FROM information_schema.columns 
      WHERE (data_type = 'character varying' OR data_type = 'text')
        AND (
          (table_name = 'landings' AND column_name IN ('tipo_pagina', 'radio_bordes', 'fuente', 'tema_modo')) OR
          (table_name = 'landing_templates' AND column_name IN ('funnel_type', 'status')) OR
          (table_name = 'landing_items' AND column_name = 'tipo')
        );
    `);
    console.log(res[0]);
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
check();
