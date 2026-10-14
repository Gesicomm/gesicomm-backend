'use strict';
require('dotenv').config();
const { sequelize, RahaSolicitud, RahaDocumento } = require('../src/models');
const storage = require('../src/services/raha/storage');

async function limpiarPrueba() {
  console.log('Iniciando limpieza de prueba RAHA...');

  // 1. Buscar solicitud 1 (o solicitudes con datos de prueba)
  const solicitud = await RahaSolicitud.findByPk(1);
  if (!solicitud) {
    console.log('No se encontró la solicitud #1.');
    return;
  }

  console.log(`Solicitud #${solicitud.id} encontrada. Estado: ${solicitud.estado}`);

  // 2. Buscar documentos asociados
  const docs = await RahaDocumento.findAll({ where: { solicitud_id: solicitud.id } });
  console.log(`Documentos a eliminar: ${docs.length}`);

  for (const doc of docs) {
    console.log(`Eliminando de almacenamiento: ${doc.nombre} (${doc.storage_key}) [backend: ${doc.storage_backend}]...`);
    try {
      await storage.remove(doc);
      console.log(`  ✓ Eliminado de R2 / almacenamiento privado`);
    } catch (err) {
      console.warn(`  ⚠ Error al eliminar de almacenamiento (puede que ya no exista): ${err.message}`);
    }
    await doc.destroy();
    console.log(`  ✓ Registro en BD eliminado`);
  }

  // 3. Eliminar notificaciones asociadas
  try {
    const [delNotifs] = await sequelize.query(
      `DELETE FROM notificaciones WHERE entidad_tipo IN ('raha_solicitud', 'raha_solicitud_admin') AND entidad_id = ${solicitud.id}`
    );
    console.log(`Notificaciones eliminadas.`);
  } catch (err) {
    console.warn(`Aviso al limpiar notificaciones: ${err.message}`);
  }

  // 4. Eliminar la solicitud por completo
  await solicitud.destroy();
  console.log(`✓ Solicitud #${solicitud.id} eliminada completamente de la base de datos.`);

  console.log('Limpieza finalizada exitosamente.');
}

limpiarPrueba()
  .then(async () => {
    await sequelize.close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Error durante la limpieza:', err);
    await sequelize.close();
    process.exit(1);
  });
