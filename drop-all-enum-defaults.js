const db = require('./src/models');

async function dropAllEnumDefaults() {
  try {
    const res = await db.sequelize.query(`
      SELECT table_name, column_name
      FROM information_schema.columns 
      WHERE data_type = 'USER-DEFINED' AND column_default IS NOT NULL;
    `);
    
    for (const row of res[0]) {
      const table = row.table_name;
      const col = row.column_name;
      await db.sequelize.query(`ALTER TABLE "${table}" ALTER COLUMN "${col}" DROP DEFAULT;`);
      console.log(`Dropped default for ${table}.${col}`);
    }
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
dropAllEnumDefaults();
