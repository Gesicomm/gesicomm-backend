'use strict';

module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/test-integration/**/*.spec.js'],
  globalSetup: '<rootDir>/test-integration/globalSetup.js',
  globalTeardown: '<rootDir>/test-integration/globalTeardown.js',
  testEnvironment: 'node',
  testTimeout: 30000,
  // Una sola conexión de trabajo por archivo, y todo el harness corre
  // secuencialmente: las pruebas de concurrencia arman su propia carrera
  // con Promise.all DENTRO de un test, no dependen de que Jest paralelice
  // archivos. Correr en band evita que dos specs se pisen sobre las mismas
  // filas por accidente.
  maxWorkers: 1,
};
