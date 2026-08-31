const db = require('./src/models');

async function fixBuilderDomain() {
  try {
    await db.sequelize.query(`ALTER TABLE "builder_domains" RENAME COLUMN "dominio" TO "hostname";`);
    await db.sequelize.query(`ALTER TABLE "builder_domains" ADD COLUMN IF NOT EXISTS "pagina_id" INTEGER;`);
    await db.sequelize.query(`ALTER TABLE "builder_domains" ADD COLUMN IF NOT EXISTS "tipo" VARCHAR(20) NOT NULL DEFAULT 'subdominio';`);
    await db.sequelize.query(`ALTER TABLE "builder_domains" ADD COLUMN IF NOT EXISTS "subdominio" VARCHAR(63);`);
    await db.sequelize.query(`ALTER TABLE "builder_domains" ADD COLUMN IF NOT EXISTS "es_principal" BOOLEAN NOT NULL DEFAULT true;`);
    console.log("Fixed builder_domains schema in DB.");
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
fixBuilderDomain();
