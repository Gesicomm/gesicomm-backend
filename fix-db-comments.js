const db = require('./src/models');

async function fixComments() {
  try {
    await db.sequelize.query(`COMMENT ON COLUMN "producto_combos"."estado" IS NULL;`);
    console.log("Removed comment from producto_combos.estado");
    
    await db.sequelize.query(`COMMENT ON COLUMN "productos"."estado_venta" IS NULL;`);
    console.log("Removed comment from productos.estado_venta");
    
    await db.sequelize.query(`COMMENT ON COLUMN "envios"."estado_financiero" IS NULL;`);
    console.log("Removed comment from envios.estado_financiero");
    
    await db.sequelize.query(`COMMENT ON COLUMN "meta_campanas_internas"."tipo" IS NULL;`);
    console.log("Removed comment from meta_campanas_internas.tipo");
    
    await db.sequelize.query(`COMMENT ON COLUMN "metodos_pago"."custodia_cobro" IS NULL;`);
    console.log("Removed comment from metodos_pago.custodia_cobro");
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
fixComments();
