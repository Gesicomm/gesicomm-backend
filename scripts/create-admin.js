require('dotenv').config();
const { sequelize, Usuario, Rol, Inquilino } = require('../src/models');
const bcrypt = require('bcryptjs');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function createAdmin() {
  try {
    await sequelize.authenticate();
    
    // Buscar rol administrador
    const rolAdmin = await Rol.findOne({ where: { nombre: 'administrador' } });
    if (!rolAdmin) {
      console.error('❌ El rol administrador no existe. Corre "npm run seed" primero.');
      process.exit(1);
    }

    // Verificar si ya existe un admin (protección básica propuesta)
    const adminCount = await Usuario.count({
      where: { rol_id: rolAdmin.id }
    });

    const force = process.argv.includes('--force');

    if (adminCount > 0 && !force) {
      console.log('⚠️ Ya existe al menos un administrador en la base de datos.');
      console.log('Si necesitas crear otro, usa el flag --force o hazlo desde la UI de administración.');
      process.exit(1);
    }

    console.log('\n--- Creación de Cuenta Administradora ---');
    const nombre = await question('Nombre completo: ');
    const email = await question('Email: ');
    const password = await question('Contraseña: ');

    if (!nombre || !email || !password) {
      console.error('❌ Todos los campos son obligatorios.');
      process.exit(1);
    }

    // Buscar o crear la empresa (MVP logic)
    const [inquilino] = await Inquilino.findOrCreate({ 
      where: { nombre: 'Gesicomm Principal' }
    });

    const hashedPassword = await bcrypt.hash(password, 12);

    const usuario = await Usuario.create({
      inquilino_id: inquilino.id,
      rol_id: rolAdmin.id,
      nombre,
      correo_electronico: email,
      contrasena_hash: hashedPassword,
    });

    console.log(`\n✅ Administrador creado con éxito: ${usuario.correo_electronico}`);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      console.error('❌ El correo ya está registrado en la base de datos.');
    } else {
      console.error('❌ Error fatal al crear administrador:', error);
    }
  } finally {
    rl.close();
    process.exit(0);
  }
}

createAdmin();
