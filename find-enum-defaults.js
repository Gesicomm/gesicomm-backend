const db = require('./src/models');

async function checkAllEnums() {
  try {
    const res = await db.sequelize.query(`
      SELECT table_name, column_name, data_type, udt_name, column_default
      FROM information_schema.columns 
      WHERE data_type = 'USER-DEFINED' AND column_default IS NOT NULL;
    `);
    console.log("ENUM columns with defaults:");
    console.table(res[0]);
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
checkAllEnums();
