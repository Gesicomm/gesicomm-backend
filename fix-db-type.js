const db = require('./src/models');

async function fixDB() {
  try {
    await db.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_producto_combos_estado') THEN
          CREATE TYPE "public"."enum_producto_combos_estado" AS ENUM('BORRADOR', 'ACTIVO', 'INACTIVO');
        END IF;
      END
      $$;
    `);
    console.log("Created ENUM type");

    await db.sequelize.query(`
      ALTER TABLE "producto_combos" 
      ALTER COLUMN "estado" TYPE "public"."enum_producto_combos_estado" 
      USING "estado"::"public"."enum_producto_combos_estado";
    `);
    console.log("Altered column type");

    await db.sequelize.query(`
      ALTER TABLE "producto_combos" 
      ALTER COLUMN "estado" SET DEFAULT 'BORRADOR'::"public"."enum_producto_combos_estado";
    `);
    console.log("Set default");

  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
fixDB();
