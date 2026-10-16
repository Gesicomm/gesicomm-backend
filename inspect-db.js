const { Sequelize } = require('sequelize');
const sequelize = new Sequelize('gesicomm', 'gesicomm', 'gestionecommerce1!', {
  host: '127.0.0.1',
  port: 5434,
  dialect: 'postgres',
  logging: false
});

async function run() {
  try {
    const [tables] = await sequelize.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
      ORDER BY table_schema, table_name;
    `);
    console.log("Tablas en DB:");
    tables.forEach(t => console.log(`  ${t.table_schema}.${t.table_name}`));

    // Check if there are tables with instagram, token, credential, account, etc.
    for (const t of tables) {
      if (/credential|meta|instagram|facebook|cuenta|token/i.test(t.table_name)) {
        try {
          const [rows] = await sequelize.query(`SELECT * FROM "${t.table_schema}"."${t.table_name}" LIMIT 5;`);
          console.log(`\nDatos en ${t.table_schema}.${t.table_name} (${rows.length} filas):`);
          rows.forEach(r => {
            const copy = { ...r };
            // don't flood logs with long tokens, just peek
            for (let k in copy) {
              if (typeof copy[k] === 'string' && copy[k].length > 40) {
                copy[k] = copy[k].substring(0, 30) + '...';
              }
            }
            console.log(copy);
          });
        } catch(e) {
          console.error(`Error querying ${t.table_name}:`, e.message);
        }
      }
    }
  } catch(e) {
    console.error(e);
  } finally {
    sequelize.close();
  }
}

run();
