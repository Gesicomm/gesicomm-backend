const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: '127.0.0.1',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false
  }
);

async function checkQueries() {
  try {
    const [results] = await sequelize.query(`
      SELECT pid, now() - query_start as duration, query, state 
      FROM pg_stat_activity 
      WHERE state != 'idle' 
      AND query NOT ILIKE '%pg_stat_activity%'
    `);
    console.log(JSON.stringify(results, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await sequelize.close();
  }
}

checkQueries();
