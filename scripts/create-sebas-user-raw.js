require('dotenv').config();
const { sequelize, Rol } = require('../src/models');
const bcrypt = require('bcryptjs');

async function createSebasUser() {
  try {
    await sequelize.authenticate();
    
    const r = await Rol.findOne({ where: { nombre: 'solo_pedidos' } });
    const hash = await bcrypt.hash('Cabezadepija123', 12);
    
    // Check if it already exists
    const [existing] = await sequelize.query(`SELECT id FROM usuarios WHERE correo_electronico = 'sebas@gesicom'`);
    if (existing.length > 0) {
      await sequelize.query(`UPDATE usuarios SET contrasena_hash = '${hash}', rol_id = ${r.id}, inquilino_id = 2 WHERE correo_electronico = 'sebas@gesicom'`);
      console.log('✅ Actualizado saltando validación');
    } else {
      await sequelize.query(`INSERT INTO usuarios (inquilino_id, rol_id, nombre, correo_electronico, contrasena_hash, activo, email_verificado, "createdAt", "updatedAt") VALUES (2, ${r.id}, 'Sebas', 'sebas@gesicom', '${hash}', true, true, NOW(), NOW())`);
      console.log('✅ Creado saltando validación');
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

createSebasUser();
