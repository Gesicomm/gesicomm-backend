const { sequelize, ModuloEducacion, Examen, PreguntaExamen, ProgresoUsuarioModulo } = require('../src/models');

async function migrarEducacion() {
  try {
    console.log("Iniciando sincronización de tablas de Educación...");
    await sequelize.query('ALTER TABLE "modulos_educacion" ALTER COLUMN "inquilino_id" DROP NOT NULL;');
    await ModuloEducacion.sync({ alter: true });
    await Examen.sync({ alter: true });
    await PreguntaExamen.sync({ alter: true });
    await ProgresoUsuarioModulo.sync({ alter: true });
    console.log("Tablas de educación sincronizadas correctamente.");
  } catch (error) {
    console.error("Error al sincronizar tablas de educación:", error);
    throw error;
  }
}

if (require.main === module) {
  migrarEducacion().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { migrarEducacion };
