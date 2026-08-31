const db = require('./src/models');

async function fixDB() {
  try {
    await db.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_landings_tipo_pagina') THEN
          CREATE TYPE "public"."enum_landings_tipo_pagina" AS ENUM('inicio', 'catalogo', 'contacto', 'funnel');
        END IF;
      END
      $$;
    `);
    console.log("Created ENUM type");

    await db.sequelize.query(`
      ALTER TABLE "landings" 
      ALTER COLUMN "tipo_pagina" TYPE "public"."enum_landings_tipo_pagina" 
      USING "tipo_pagina"::"public"."enum_landings_tipo_pagina";
    `);
    console.log("Altered column type");

    await db.sequelize.query(`
      ALTER TABLE "landings" 
      ALTER COLUMN "tipo_pagina" SET DEFAULT 'funnel'::"public"."enum_landings_tipo_pagina";
    `);
    console.log("Set default");

  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
fixDB();
