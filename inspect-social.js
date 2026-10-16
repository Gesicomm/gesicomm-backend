const { Sequelize } = require('sequelize');
const sequelize = new Sequelize('gesicomm', 'gesicomm', 'gestionecommerce1!', {
  host: '127.0.0.1',
  port: 5434,
  dialect: 'postgres',
  logging: false
});

async function run() {
  try {
    const [rows] = await sequelize.query('SELECT * FROM automatization_hub."SocialAccounts";');
    console.log('SocialAccounts count:', rows.length);
    for (const r of rows) {
      console.log('Platform:', r.platform, 'Account Name:', r.account_name, 'Account ID:', r.account_id);
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    sequelize.close();
  }
}
run();
