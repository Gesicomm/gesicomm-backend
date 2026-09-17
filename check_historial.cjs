const { sequelize } = require('./src/models');
const { QueryTypes } = require('sequelize');

async function check() {
  // check all tables with "envio" in name
  const tables = await sequelize.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%envio%' ORDER BY table_name",
    { type: QueryTypes.SELECT }
  );
  console.log('Envio-related tables:', tables.map(r => r.table_name).join(', '));

  // Check EnvioHistorial 
  try {
    const histSample = await sequelize.query(
      'SELECT * FROM envio_historials LIMIT 3',
      { type: QueryTypes.SELECT }
    );
    console.log('Historial sample:', JSON.stringify(histSample, null, 2));
  } catch(e) {
    console.log('historial error:', e.message);
  }

  // Check intentos_entrega
  try {
    const intentosCols = await sequelize.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'envio_intento_entregas' ORDER BY column_name",
      { type: QueryTypes.SELECT }
    );
    console.log('Intentos columns:', intentosCols.map(r => r.column_name).join(', '));
  } catch(e) {
    console.log('intentos error:', e.message);
  }

  process.exit(0);
}
check().catch(e => { console.error(e.message); process.exit(1); });
