const { Sequelize } = require('sequelize');
const sequelize = new Sequelize('gesicomm', 'gesicomm', 'gestionecommerce1!', {
  host: '127.0.0.1',
  port: 5434,
  dialect: 'postgres',
  logging: false
});

async function run() {
  try {
    const [socials] = await sequelize.query('SELECT * FROM automatization_hub.social_accounts;');
    console.log('Social Accounts:');
    socials.forEach(s => console.log(JSON.stringify(s, null, 2)));

    const [manychats] = await sequelize.query('SELECT * FROM automatization_hub.manychat_connections;');
    console.log('Manychat Connections:');
    manychats.forEach(m => console.log(JSON.stringify(m, null, 2)));
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    sequelize.close();
  }
}
run();
