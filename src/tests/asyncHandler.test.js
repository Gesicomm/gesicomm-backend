'use strict';

/**
 * Regresión de la caída del 2026-09-20.
 *
 * Un `read ECONNRESET` del túnel de Postgres adentro de
 * `seguimientoController.listarNotificaciones` —handler `async` sin
 * try/catch— se convirtió en un `unhandledRejection` y Node 22 mató el
 * proceso entero. El endpoint lo pollea NotificationBell para todo usuario
 * logueado, así que cualquier hipo de la base lo disparaba.
 *
 * Lo que se verifica acá:
 *  1. un handler async que se rechaza responde 500 y NO tumba el proceso;
 *  2. el mismo escenario SIN el wrapper sí lo tumba (control negativo: si
 *     esto pasara, el punto 1 no probaría nada);
 *  3. los controllers que se cubrieron quedaron cubiertos de verdad, handler
 *     por handler, incluidos los que se agreguen después;
 *  4. los manejadores de proceso hacen lo que dice la decisión documentada
 *     en src/utils/erroresProceso.js.
 *
 * No toca la base: los modelos se mockean. La de localhost:5434 es
 * PRODUCCIÓN detrás de un túnel.
 */

const path = require('path');
const { execFile } = require('child_process');
const express = require('express');
const request = require('supertest');

const { asyncHandler, envolverControlador, estaEnvuelto } = require('../utils/asyncHandler');
const { instalarManejadoresDeProceso } = require('../utils/erroresProceso');

jest.mock('../models', () => ({
  WhatsappPlantilla: {},
  SeguimientoEtiqueta: {},
  SeguimientoConfiguracion: {},
  Notificacion: { findAll: jest.fn(), count: jest.fn() },
  SeguimientoRecordatorio: { count: jest.fn() },
}));
jest.mock('../services/seguimiento/plantillaResolver.service', () => ({
  listarVariablesDisponibles: () => [],
}));

const { Notificacion } = require('../models');
const seguimientoController = require('../controllers/seguimientoController');

const FIXTURE = path.join(__dirname, 'fixtures', 'procesoVivo.fixture.js');

/** Error tal cual lo tira el driver de pg cuando se corta el túnel. */
function errorDeConexion() {
  const err = new Error('read ECONNRESET');
  err.code = 'ECONNRESET';
  return err;
}

/**
 * App mínima con la misma forma que server.js: el handler, y el middleware
 * de errores de 4 parámetros al final.
 */
function appCon(handler) {
  const app = express();
  app.use(express.json());
  app.get('/prueba', (req, res, next) => {
    req.usuario = { id: 7, rol: 'vendedor' };
    next();
  }, handler);
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ message: 'Error interno del servidor.' });
  });
  return app;
}

/** Corre el fixture como proceso aparte y devuelve cómo terminó. */
function correrFixture(modo) {
  return new Promise((resolve) => {
    const args = modo ? [FIXTURE, modo] : [FIXTURE];
    execFile(process.execPath, args, (error, stdout, stderr) => {
      resolve({ codigo: error ? error.code ?? 1 : 0, stdout, stderr });
    });
  });
}

describe('asyncHandler — el rechazo de un handler async no tumba el proceso', () => {
  beforeEach(() => jest.clearAllMocks());

  test('listarNotificaciones con la base caída responde 500 y no explota', async () => {
    Notificacion.findAll.mockRejectedValue(errorDeConexion());

    const res = await request(appCon(seguimientoController.listarNotificaciones)).get('/prueba');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Error interno del servidor.' });
  });

  test('el error llega entero al middleware de errores, no uno genérico', async () => {
    Notificacion.findAll.mockRejectedValue(errorDeConexion());

    let recibido = null;
    const app = express();
    app.get('/prueba', (req, res, next) => { req.usuario = { id: 7, rol: 'vendedor' }; next(); },
      seguimientoController.listarNotificaciones);
    app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
      recibido = err;
      res.status(500).json({ message: 'Error interno del servidor.' });
    });

    await request(app).get('/prueba');

    // Sin esto el log del middleware no serviría para diagnosticar nada.
    expect(recibido).toBeInstanceOf(Error);
    expect(recibido.code).toBe('ECONNRESET');
    expect(recibido.message).toBe('read ECONNRESET');
  });

  test('el camino feliz sigue igual: el wrapper no toca la respuesta', async () => {
    Notificacion.findAll.mockResolvedValue([{ id: 1, leida: false }]);
    Notificacion.count.mockResolvedValue(1);
    require('../models').SeguimientoRecordatorio.count.mockResolvedValue(3);

    const res = await request(appCon(seguimientoController.listarNotificaciones)).get('/prueba');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [{ id: 1, leida: false }],
      no_leidas: 1,
      seguimientos_vencidos: 3,
    });
  });

  test('un proceso real atiende el 500 y sigue respondiendo después', async () => {
    const { codigo, stdout } = await correrFixture();

    expect(codigo).toBe(0);
    const salida = JSON.parse(stdout);
    expect(salida.explota.status).toBe(500);
    // La prueba de vida: esta segunda request se atendió DESPUÉS del rechazo.
    expect(salida.sano.status).toBe(200);
    expect(salida.vivo).toBe(true);
  }, 20000);

  test('control negativo: el mismo escenario sin wrapper mata el proceso', async () => {
    const { codigo, stdout, stderr } = await correrFixture('sin-wrapper');

    expect(codigo).not.toBe(0);
    expect(stdout).toBe(''); // murió antes de poder reportar
    expect(stderr).toContain('ECONNRESET');
  }, 20000);
});

describe('asyncHandler — comportamiento del wrapper', () => {
  test('deriva el rechazo a next y conserva la aridad que Express mira', async () => {
    const next = jest.fn();
    const envuelto = asyncHandler(async () => { throw new Error('boom'); });

    expect(envuelto.length).toBe(3); // 4 lo convertiría en middleware de error
    await envuelto({}, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].message).toBe('boom');
  });

  test('un throw síncrono también termina en next', async () => {
    const next = jest.fn();
    await asyncHandler(() => { throw new Error('sync'); })({}, {}, next);

    expect(next.mock.calls[0][0].message).toBe('sync');
  });

  test('no llama a next cuando el handler sale bien', async () => {
    const next = jest.fn();
    await asyncHandler(async (req, res) => res.json({ ok: true }))({}, { json: () => {} }, next);

    expect(next).not.toHaveBeenCalled();
  });

  test('envolver dos veces devuelve el mismo handler', () => {
    const una = asyncHandler(async () => {});
    expect(asyncHandler(una)).toBe(una);
  });

  test('envolverControlador saltea lo que no es handler', () => {
    const helper = async (items, t, usuarioId) => [items, t, usuarioId];
    const middlewareDeError = (err, req, res, next) => next(err);
    const controlador = {
      listar: async (req, res) => res.json([]),
      CONSTANTE: 42,
      helper,
      middlewareDeError,
    };

    envolverControlador(controlador, { excluir: ['helper'] });

    expect(estaEnvuelto(controlador.listar)).toBe(true);
    expect(controlador.helper).toBe(helper); // excluido a mano
    expect(controlador.middlewareDeError).toBe(middlewareDeError); // aridad 4
    expect(controlador.CONSTANTE).toBe(42);
  });
});

describe('controllers cubiertos por la red de contencion', () => {
  // Si alguien agrega un handler nuevo a estos archivos queda cubierto solo,
  // porque el envolverControlador va al final del archivo y toma todo lo
  // exportado. Este test es el que avisa si alguien saca esa linea.
  const cubiertos = {
    seguimientoController: [],
    envioSeguimientoController: [],
    courierController: [],
    depositoController: [],
    metodoPagoController: [],
    'afiliados.controller': [],
    'liquidacion.controller': [],
    'paymentGateways.controller': [],
    'suscripciones.controller': [],
    'webhooks.controller': [],
    envioController: ['descontarStockYSnapshot', 'calcularAbastecimientoDesdeItems'],
  };

  test.each(Object.entries(cubiertos))('%s tiene todos sus handlers envueltos', (archivo, excluidos) => {
    const controlador = require('../controllers/' + archivo);
    const sinEnvolver = Object.entries(controlador)
      .filter(([nombre, valor]) => typeof valor === 'function'
        && !excluidos.includes(nombre)
        && valor.length !== 4
        && !estaEnvuelto(valor))
      .map(([nombre]) => nombre);

    expect(sinEnvolver).toEqual([]);
  });
});

describe('manejadores de proceso: la decision documentada', () => {
  test('unhandledRejection loguea con contexto y NO mata el proceso', () => {
    const log = { error: jest.fn() };
    const salir = jest.fn();
    const { manejarRechazo } = instalarManejadoresDeProceso({ log, salir, registrar: false });

    manejarRechazo(errorDeConexion());

    expect(salir).not.toHaveBeenCalled();
    const registro = log.error.mock.calls[0][0];
    expect(registro.evento).toBe('PROMESA_RECHAZADA_SIN_MANEJAR');
    expect(registro.codigo).toBe('ECONNRESET');
    expect(registro.stack).toContain('ECONNRESET');
    expect(registro.accion).toBe('proceso_sigue_vivo');
  });

  test('unhandledRejection aguanta un rechazo que no es Error', () => {
    const log = { error: jest.fn() };
    const salir = jest.fn();
    const { manejarRechazo } = instalarManejadoresDeProceso({ log, salir, registrar: false });

    manejarRechazo('se rechazo con un string');

    expect(log.error.mock.calls[0][0].mensaje).toBe('se rechazo con un string');
    expect(salir).not.toHaveBeenCalled();
  });

  test('uncaughtException cierra el server y sale con 1 para que lo levante el supervisor', (done) => {
    const log = { error: jest.fn() };
    const servidor = { close: (cb) => cb() };
    const salir = (codigo) => {
      expect(codigo).toBe(1);
      expect(log.error.mock.calls[0][0].evento).toBe('EXCEPCION_NO_ATRAPADA');
      done();
    };
    const { manejarExcepcion } = instalarManejadoresDeProceso({
      log, salir, registrar: false, obtenerServidor: () => servidor,
    });

    manejarExcepcion(new Error('estado indefinido'));
  });

  test('uncaughtException sale igual si el cierre se cuelga', (done) => {
    const log = { error: jest.fn() };
    const servidor = { close: () => {} }; // nunca llama al callback
    const { manejarExcepcion } = instalarManejadoresDeProceso({
      log,
      salir: (codigo) => { expect(codigo).toBe(1); done(); },
      registrar: false,
      obtenerServidor: () => servidor,
      msEsperaCierre: 20,
    });

    manejarExcepcion(new Error('drenado colgado'));
  });
});
