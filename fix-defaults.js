const db = require('./src/models');

async function fix() {
  try {
    await db.sequelize.query(`ALTER TABLE "producto_combos" ALTER COLUMN "estado" DROP DEFAULT;`);
    console.log("Dropped default for producto_combos");
    await db.sequelize.query(`ALTER TABLE "productos" ALTER COLUMN "estado_venta" DROP DEFAULT;`);
    console.log("Dropped default for productos");
    await db.sequelize.query(`ALTER TABLE "envios" ALTER COLUMN "estado_financiero" DROP DEFAULT;`);
    console.log("Dropped default for envios");
    await db.sequelize.query(`ALTER TABLE "meta_campanas_internas" ALTER COLUMN "tipo" DROP DEFAULT;`);
    console.log("Dropped default for meta_campanas_internas");
    await db.sequelize.query(`ALTER TABLE "metodos_pago" ALTER COLUMN "custodia_cobro" DROP DEFAULT;`);
    console.log("Dropped default for metodos_pago");
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
fix();
