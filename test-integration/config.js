'use strict';

/**
 * Config fija de la BD Postgres efímera de estos tests. A propósito bien
 * distinta de cualquier config real del proyecto:
 *   - puerto 55432, nunca 5432 ni el 5434 del túnel a producción;
 *   - nombre de base y de contenedor exclusivos de este harness.
 *
 * Ningún test de este directorio lee `.env` del proyecto para la conexión:
 * globalSetup.js fija estas variables en `process.env` ANTES de que
 * cualquier `require('../src/models')` corra `dotenv.config()` — y dotenv
 * nunca pisa una variable que ya está seteada, así que esto siempre gana.
 */
module.exports = {
  CONTAINER_NAME: 'gesicomm-backend-test-pg',
  HOST: '127.0.0.1',
  PORT: '55432',
  DB_NAME: 'gesicomm_test_integration',
  DB_USER: 'postgres',
  DB_PASSWORD: 'test_efimero_local',
};
