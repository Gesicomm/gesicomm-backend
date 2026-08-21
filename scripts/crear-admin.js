require('dotenv').config();
const { Usuario, Role, sequelize, Inquilino } = require('../src/models');
const bcrypt = require('bcryptjs');

async function main() {
  try {
    await sequelize.authenticate();
    
    // Check if role exists
    let adminRole = await Role.findOne({ where: { nombre: 'admin' } });
    if (!adminRole) {
      console.log('Role "admin" not found. Looking for available roles...');
      const allRoles = await Role.findAll();
      console.log('Available roles:', allRoles.map(r => r.nombre));
      
      // Try 'administrador' if 'admin' is not there
      adminRole = await Role.findOne({ where: { nombre: 'administrador' } });
    }
    
    if (!adminRole) {
      console.log('Could not find admin role. Exiting.');
      return;
    }

    // Try to find a tenant to assign this admin to
    let inquilino = await Inquilino.findOne();
    const inquilinoId = inquilino ? inquilino.id : 1;
    console.log('Asignando al inquilino ID:', inquilinoId);

    const email = 'admin@gesicom.com';
    const password = 'Admin123';
    const hashedPassword = await bcrypt.hash(password, 10);

    const [user, created] = await Usuario.findOrCreate({
      where: { email },
      defaults: {
        nombre: 'Admin Gesicom',
        email: email,
        password: hashedPassword,
        rol_id: adminRole.id,
        inquilino_id: inquilinoId,
        estado: 'activo'
      }
    });

    if (created) {
      console.log('Usuario admin creado exitosamente:', email);
    } else {
      console.log('El usuario ya existía. Actualizando password...');
      user.password = hashedPassword;
      user.rol_id = adminRole.id;
      user.inquilino_id = inquilinoId;
      await user.save();
      console.log('Usuario admin actualizado exitosamente:', email);
    }
  } catch (error) {
    console.error('Error al crear usuario:', error);
  } finally {
    process.exit(0);
  }
}

main();
