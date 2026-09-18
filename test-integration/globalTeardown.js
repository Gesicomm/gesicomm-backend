'use strict';

const { execFileSync } = require('child_process');
const { CONTAINER_NAME } = require('./config');

module.exports = async function globalTeardown() {
  try {
    execFileSync('docker', ['rm', '-f', CONTAINER_NAME], { stdio: 'pipe' });
    console.log(`[integration] Contenedor ${CONTAINER_NAME} destruido.`);
  } catch (err) {
    console.error('[integration] No se pudo limpiar el contenedor de test:', err.message);
  }
};
