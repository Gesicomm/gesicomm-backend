const { sequelize } = require('./src/models');
const { QueryTypes } = require('sequelize');

async function check() {
  const cols = await sequelize.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'envios' ORDER BY column_name",
    { type: QueryTypes.SELECT }
  );
  console.log('Envio columns:', cols.map(r => r.column_name).join(', '));

  const courierCols = await sequelize.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'couriers' ORDER BY column_name",
    { type: QueryTypes.SELECT }
  );
  console.log('Courier columns:', courierCols.map(r => r.column_name).join(', '));

  const sample = await sequelize.query(
    'SELECT id, estado, ciudad, departamento, fecha, courier_id FROM envios LIMIT 5',
    { type: QueryTypes.SELECT }
  );
  console.log('Envio sample:', JSON.stringify(sample, null, 2));
  
  process.exit(0);
}
check().catch(e => { console.error(e.message); process.exit(1); });
