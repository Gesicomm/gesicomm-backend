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
    console.log('Social Accounts (' + socials.length + '):');
    socials.forEach(s => console.log(' ', s.platform, s.account_name, s.account_id, s.external_id));

    const [manychats] = await sequelize.query('SELECT * FROM automatization_hub.manychat_connections;');
    console.log('\nManychat Connections (' + manychats.length + '):');
    manychats.forEach(m => console.log(' ', m.id, m.name, m.page_id, m.status));
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    sequelize.close();
  }
}
run();
