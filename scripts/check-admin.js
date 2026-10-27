require('dotenv').config();
const { Usuario, Rol, sequelize } = require('../src/models');

async function check() {
  try {
    const usuario = await Usuario.findOne({
      where: { correo_electronico: 'admin@gesicom.com' },
      attributes: ['id', 'correo_electronico', 'activo', 'email_verificado'],
      include: [{ model: Rol, attributes: ['nombre'] }],
    });
    const estado = usuario
      ? { existe: true, id: usuario.id, rol: usuario.Rol?.nombre || null, activo: usuario.activo, email_verificado: usuario.email_verificado }
      : { existe: false };
    console.log(JSON.stringify(estado));
    if (estado.rol !== 'administrador' || !estado.activo || !estado.email_verificado) process.exitCode = 1;
  } catch (error) {
    console.error(`No se pudo verificar la cuenta admin: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

check();
