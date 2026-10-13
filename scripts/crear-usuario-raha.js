'use strict';
// Crea o reactiva una cuenta del portal Raha (/raha/login).
// Uso: node scripts/crear-usuario-raha.js "Nombre" email@raha.com "ContrasenaSegura123"
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize, RahaPortalUsuario } = require('../src/models');

(async () => {
  const [nombre, emailRaw, password] = process.argv.slice(2);
  const email = String(emailRaw || '').trim().toLowerCase();
  if (!nombre || !email.includes('@') || !password || password.length < 10) {
    console.error('Uso: node scripts/crear-usuario-raha.js "Nombre" email@raha.com "Contrasena (min 10)"');
    process.exit(1);
  }
  await require('../migrations/20261013100000-raha-portal-usuarios').up(sequelize.getQueryInterface(), require('sequelize'));
  const password_hash = await bcrypt.hash(password, 10);
  const existente = await RahaPortalUsuario.findOne({ where: { email } });
  if (existente) await existente.update({ nombre, password_hash, activo: true });
  else await RahaPortalUsuario.create({ nombre, email, password_hash, activo: true });
  console.log(`Cuenta Raha ${existente ? 'actualizada' : 'creada'}: ${email}`);
  await sequelize.close();
})().catch(error => { console.error(error.message); process.exit(1); });
