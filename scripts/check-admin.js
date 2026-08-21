require('dotenv').config();
const { Usuario } = require('../src/models');
async function check() {
  const u = await Usuario.findOne({ where: { email: 'admin@gesicom.com' } });
  console.log(JSON.stringify(u, null, 2));
  process.exit(0);
}
check();
