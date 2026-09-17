const { sequelize } = require('./src/models');
const { QueryTypes } = require('sequelize');

async function check() {
  // Check if dispatchedAt is populated
  const sample = await sequelize.query(
    `SELECT id, estado, "dispatchedAt", fecha FROM envios 
     WHERE estado IN ('Entregado', 'Devuelto', 'Rechazado') 
     LIMIT 10`,
    { type: QueryTypes.SELECT }
  );
  console.log('dispatchedAt sample:', JSON.stringify(sample, null, 2));
  
  // Check historial for date_entrega
  const histCols = await sequelize.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'envio_historials' ORDER BY column_name",
    { type: QueryTypes.SELECT }
  );
  console.log('Historial columns:', histCols.map(r => r.column_name).join(', '));
  
  process.exit(0);
}
check().catch(e => { console.error(e.message); process.exit(1); });
