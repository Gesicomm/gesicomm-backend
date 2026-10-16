'use strict';
const { EventEmitter } = require('node:events');
const { crearDiagnosticoMemoria } = require('../utils/diagnosticoMemoria');

function solicitud(diag, url = '/api/l/producto?token=secreto') {
  const res = new EventEmitter();
  res.statusCode = 200;
  diag.middleware({ originalUrl: url, method: 'GET', body: { secreto: 'no guardar' }, cookies: { token: 'no guardar' } }, res, () => {});
  return res;
}

test('registra una solicitud todavía en curso y elimina query, cuerpo y cookies', () => {
  let tiempo = 100;
  const diag = crearDiagnosticoMemoria({ escribir: jest.fn(), ahora: () => tiempo });
  solicitud(diag);
  tiempo = 200;
  const contexto = diag.muestra();
  expect(contexto.enCurso).toBe(1);
  expect(contexto.activas[0]).toMatchObject({ ruta: '/api/l/producto', ms: 100 });
  expect(JSON.stringify(contexto)).not.toMatch(/secreto|no guardar/);
});

test.each(['finish', 'close'])('libera referencias al recibir %s y no cuenta dos veces', evento => {
  const diag = crearDiagnosticoMemoria({ escribir: jest.fn() });
  const res = solicitud(diag);
  res.emit(evento);
  res.emit('finish');
  res.emit('close');
  expect(diag.muestra()).toMatchObject({ enCurso: 0, activas: [], recientes: [{ estado: 200 }] });
  expect(res.listenerCount('finish')).toBe(0);
  expect(res.listenerCount('close')).toBe(0);
});

test('acota solicitudes e historial aunque se acumulen conexiones', () => {
  const diag = crearDiagnosticoMemoria({ escribir: jest.fn(), maxActivas: 2, maxRecientes: 2 });
  const respuestas = Array.from({ length: 20 }, () => solicitud(diag));
  expect(diag.muestra()).toMatchObject({ enCurso: 20, omitidas: 18 });
  expect(diag.muestra().activas).toHaveLength(2);
  respuestas.forEach(r => r.emit('finish'));
  expect(diag.muestra()).toMatchObject({ enCurso: 0, activas: [] });
  expect(diag.muestra().recientes).toHaveLength(2);
});

test('oculta rutas externas al diagnóstico que podrían contener tokens', () => {
  const diag = crearDiagnosticoMemoria({ escribir: jest.fn() });
  solicitud(diag, '/api/auth/reset/secreto');
  expect(diag.muestra().activas[0].ruta).toBe('(otra ruta)');
});
