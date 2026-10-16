const { Sequelize } = require('sequelize');
const sequelize = new Sequelize('gesicomm', 'gesicomm', 'gestionecommerce1!', {
  host: '127.0.0.1',
  port: 5434,
  dialect: 'postgres',
  logging: false
});

async function run() {
  try {
    const [rows] = await sequelize.query('SELECT * FROM automatization_hub."ManychatConnections";');
    console.log('ManychatConnections count:', rows.length);
    for (const r of rows) {
      console.log('Page ID:', r.page_id, 'Name:', r.page_name, 'Created:', r.createdAt);
    }
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    sequelize.close();
  }
}
run();
