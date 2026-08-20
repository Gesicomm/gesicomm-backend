require('dotenv').config();
const { sequelize, Usuario, Rol, Inquilino } = require('../src/models');
const bcrypt = require('bcryptjs');

async function createSebasUser() {
  try {
    await sequelize.authenticate();
    console.log('Conectado a la base de datos.');

    // 1. Crear el rol "solo_pedidos" si no existe
    let rolSoloPedidos = await Rol.findOne({ where: { nombre: 'solo_pedidos' } });
    if (!rolSoloPedidos) {
      rolSoloPedidos = await Rol.create({ nombre: 'solo_pedidos' });
      console.log('✅ Rol solo_pedidos creado.');
    } else {
      console.log('✅ Rol solo_pedidos ya existía.');
    }

    const passwordPlana = 'Cabezadepija123';
    const hashedPassword = await bcrypt.hash(passwordPlana, 12);
    const email = 'sebas@gesicom';

    // Inquilino 2 (el de user 16)
    const inquilino_id = 2;

    let user = await Usuario.findOne({ where: { correo_electronico: email } });
    if (user) {
      user.contrasena_hash = hashedPassword;
      user.rol_id = rolSoloPedidos.id;
      user.inquilino_id = inquilino_id;
      user.activo = true;
      user.nombre = 'Sebas';
      await user.save();
      console.log(`✅ Usuario existente actualizado: ${email}`);
    } else {
      user = await Usuario.create({
        inquilino_id: inquilino_id,
        rol_id: rolSoloPedidos.id,
        nombre: 'Sebas',
        correo_electronico: email,
        contrasena_hash: hashedPassword,
        activo: true,
        email_verificado: true
      });
      console.log(`✅ Nuevo usuario creado: ${email}`);
    }

    console.log('Hecho.');
  } catch (err) {
    console.error('❌ Error al crear usuario:', err);
  } finally {
    process.exit(0);
  }
}

createSebasUser();
