const { Usuario, Inquilino } = require('../src/models');
const bcrypt = require('bcryptjs');

async function checkUser() {
  const users = await Usuario.findAll({ limit: 5 });
  console.log("Usuarios en DB:", users.map(u => ({ id: u.id, email: u.correo_electronico, rol: u.rol })));
}

checkUser().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
