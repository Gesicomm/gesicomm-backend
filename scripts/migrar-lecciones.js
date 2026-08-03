const { sequelize, ModuloEducacion, LeccionEducacion, ProgresoUsuarioLeccion } = require('../src/models');

async function migrar() {
  try {
    console.log('--- Sincronizando nuevas tablas y columnas de LMS ---');
    
    // Sincronizar ModuloEducacion con alter para agregar icono, color_accent, estado, recursos_descarga
    await ModuloEducacion.sync({ alter: true });
    console.log('✓ ModuloEducacion actualizado');

    // Sincronizar LeccionEducacion
    await LeccionEducacion.sync({ alter: true });
    console.log('✓ LeccionEducacion tabla creada/sincronizada');

    // Sincronizar ProgresoUsuarioLeccion
    await ProgresoUsuarioLeccion.sync({ alter: true });
    console.log('✓ ProgresoUsuarioLeccion tabla creada/sincronizada');

    console.log('--- Migración de estructura de lecciones completada con éxito ---');
    process.exit(0);
  } catch (error) {
    console.error('Error durante la migración de lecciones:', error);
    process.exit(1);
  }
}

migrar();
