const sequelize = require('../config/database');

async function migrate() {
  try {
    await sequelize.query(`
      ALTER TABLE landing_items
      ADD COLUMN IF NOT EXISTS precio_ancla INTEGER DEFAULT NULL;
    `);
    console.log("Migración completada: precio_ancla agregado a landing_items");
  } catch (error) {
    console.error("Error en migración:", error);
  } finally {
    await sequelize.close();
  }
}

migrate();
