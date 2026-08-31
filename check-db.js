const db = require('./src/models');

async function check() {
  try {
    const res = await db.sequelize.query(`
      SELECT table_name, column_name, data_type, udt_name, column_default
      FROM information_schema.columns 
      WHERE (table_name = 'producto_combos' AND column_name = 'estado')
         OR (table_name = 'productos' AND column_name = 'estado_venta')
         OR (table_name = 'envios' AND column_name = 'estado_financiero')
         OR (table_name = 'meta_campanas_internas' AND column_name = 'tipo')
         OR (table_name = 'metodos_pago' AND column_name = 'custodia_cobro');
    `);
    console.log(res[0]);
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
check();
