require('dotenv').config();
const { sequelize } = require('../src/models');

async function run() {
  try {
    await sequelize.authenticate();
    await sequelize.query("UPDATE usuarios SET correo_electronico = 'sebas@gesicom.com' WHERE correo_electronico = 'sebas@gesicom'");
    console.log('✅ Email updated');
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
