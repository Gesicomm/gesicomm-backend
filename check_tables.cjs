const { sequelize } = require('./src/models');
const { QueryTypes } = require('sequelize');

async function check() {
  const tables = await sequelize.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    { type: QueryTypes.SELECT }
  );
  console.log('All tables:', tables.map(r => r.table_name).join('\n'));

  process.exit(0);
}
check().catch(e => { console.error(e.message); process.exit(1); });
