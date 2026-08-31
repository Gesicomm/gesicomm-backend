const db = require('./src/models');

async function cleanOrphans() {
  try {
    const tables = ['testimonios', 'faqs', 'landing_secciones', 'landing_items', 'landing_beneficios'];
    for (const t of tables) {
      await db.sequelize.query(`DELETE FROM ${t} WHERE landing_id NOT IN (SELECT id FROM landings);`);
      console.log(`Cleaned ${t}`);
    }
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
cleanOrphans();
