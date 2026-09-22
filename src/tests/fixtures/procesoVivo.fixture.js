'use strict';

/**
 * Fixture del test de asyncHandler: NO es una suite, lo levanta
 * `asyncHandler.test.js` como proceso hijo.
 *
 * Tiene que correr afuera de Jest porque lo que se verifica es justamente el
 * comportamiento del PROCESO: Jest instala sus propios listeners de
 * `unhandledRejection` y con eso el escenario original —Node matando al
 * proceso— deja de ser reproducible adentro de la suite.
 *
 * Levanta un server mínimo con la misma estructura que server.js (handler
 * async que se rechaza + middleware de errores al final), le pega dos
 * requests y reporta por stdout, en JSON, qué respondió y si sigue vivo.
 *
 * Con el argumento `sin-wrapper` corre el MISMO escenario pero con el
 * handler async pelado, como estaba el código antes del arreglo. Sirve de
 * control negativo: si ese modo también sobreviviera, el test no estaría
 * probando nada.
 */

const conWrapper = process.argv[2] !== 'sin-wrapper';

const express = require('express');
const http = require('http');
const { asyncHandler } = require('../../utils/asyncHandler');
const { instalarManejadoresDeProceso } = require('../../utils/erroresProceso');

// Igual que en server.js. `salir` se deja con el default: si algo decidiera
// matar el proceso, el test lo vería como salida temprana.
const logueado = [];
if (conWrapper) {
  instalarManejadoresDeProceso({
    log: { error: (dato) => logueado.push(dato) },
  });
}

const app = express();

// El caso real: Postgres corta la conexión en medio del findAll.
const handlerQueExplota = async () => {
  const err = new Error('read ECONNRESET');
  err.code = 'ECONNRESET';
  throw err;
};
app.get('/explota', conWrapper ? asyncHandler(handlerQueExplota) : handlerQueExplota);

app.get('/sano', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ message: 'Error interno del servidor.' });
});

function pedir(puerto, ruta) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: puerto, path: ruta }, (res) => {
      let cuerpo = '';
      res.on('data', (t) => { cuerpo += t; });
      res.on('end', () => resolve({ status: res.statusCode, cuerpo }));
    }).on('error', reject);
  });
}

const servidor = app.listen(0, async () => {
  const { port } = servidor.address();
  const explota = await pedir(port, '/explota');
  // La segunda request es la prueba de vida: si el rechazo hubiera matado al
  // proceso, esto ni se ejecuta y el hijo muere sin imprimir nada.
  const sano = await pedir(port, '/sano');

  process.stdout.write(JSON.stringify({
    explota,
    sano,
    vivo: true,
    pid: process.pid,
    logueado,
  }));
  servidor.close(() => process.exit(0));
});
