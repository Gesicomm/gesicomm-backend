require('dotenv').config();
const { sequelize, Usuario, Rol, Inquilino } = require('../src/models');
const bcrypt = require('bcryptjs');

async function createGuilleUser() {
  try {
    await sequelize.authenticate();
    console.log('Conectado a la base de datos.');

    const rolAdmin = await Rol.findOne({ where: { nombre: 'administrador' } });
    if (!rolAdmin) {
      console.error('❌ Rol administrador no encontrado.');
      process.exit(1);
    }

    let inquilino = await Inquilino.findOne({ order: [['id', 'ASC']] });
    if (!inquilino) {
      inquilino = await Inquilino.create({ nombre: 'Gesicomm Principal' });
    }

    const passwordPlana = 'Guille123!';
    const hashedPassword = await bcrypt.hash(passwordPlana, 12);

    // 1. Crear o actualizar guille.huerta@gmail.com
    const emailPrincipal = 'guille.huerta@gmail.com';
    let userGmail = await Usuario.findOne({ where: { correo_electronico: emailPrincipal } });

    if (userGmail) {
      userGmail.contrasena_hash = hashedPassword;
      userGmail.rol_id = rolAdmin.id;
      userGmail.activo = true;
      userGmail.nombre = 'Guillermo Huerta';
      await userGmail.save();
      console.log(`✅ Usuario existente actualizado: ${emailPrincipal} (Admin, activo, nueva contraseña)`);
    } else {
      userGmail = await Usuario.create({
        inquilino_id: inquilino.id,
        rol_id: rolAdmin.id,
        nombre: 'Guillermo Huerta',
        correo_electronico: emailPrincipal,
        contrasena_hash: hashedPassword,
        activo: true,
      });
      console.log(`✅ Nuevo usuario admin creado: ${emailPrincipal}`);
    }

    // 2. También actualizar guille@machodeboiceta.com si existe por compatibilidad
    const userExistente = await Usuario.findOne({ where: { correo_electronico: 'guille@machodeboiceta.com' } });
    if (userExistente) {
      userExistente.contrasena_hash = hashedPassword;
      userExistente.rol_id = rolAdmin.id;
      userExistente.activo = true;
      await userExistente.save();
      console.log('✅ Usuario previo guille@machodeboiceta.com actualizado con la contraseña Guille123!');
    }

    // 3. Crear guille.huerta@gesicomm.com por si intentan con dominio corporativo
    const emailCorp = 'guille.huerta@gesicomm.com';
    let userCorp = await Usuario.findOne({ where: { correo_electronico: emailCorp } });
    if (userCorp) {
      userCorp.contrasena_hash = hashedPassword;
      userCorp.rol_id = rolAdmin.id;
      userCorp.activo = true;
      await userCorp.save();
      console.log(`✅ Usuario corporativo actualizado: ${emailCorp}`);
    } else {
      userCorp = await Usuario.create({
        inquilino_id: inquilino.id,
        rol_id: rolAdmin.id,
        nombre: 'Guillermo Huerta',
        correo_electronico: emailCorp,
        contrasena_hash: hashedPassword,
        activo: true,
      });
      console.log(`✅ Nuevo usuario admin creado: ${emailCorp}`);
    }

    console.log('\n--- Resumen de Acceso Admin Guillermo Huerta ---');
    console.log(`Emails habilitados: ${emailPrincipal} / ${emailCorp} / guille@machodeboiceta.com`);
    console.log(`Contraseña: ${passwordPlana}`);
    console.log(`Rol: Administrador`);

  } catch (err) {
    console.error('❌ Error al crear/actualizar usuario:', err);
  } finally {
    process.exit(0);
  }
}

createGuilleUser();
