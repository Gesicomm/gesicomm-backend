'use strict';

jest.mock('dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('https', () => ({ get: jest.fn() }));
jest.mock('http', () => ({ get: jest.fn() }));
const { EventEmitter } = require('events');
const dns = require('dns/promises');
const https = require('https');
const http = require('http');
const { descargarImagenExterna } = require('../utils/descargarImagenExterna');

function respuesta({ statusCode = 200, headers = { 'content-type': 'image/webp' }, chunks = [Buffer.from('imagen')] } = {}) {
  return (url, opciones, cb) => {
    const req = new EventEmitter();
    req.destroy = error => { if (error) queueMicrotask(() => req.emit('error', error)); };
    queueMicrotask(() => {
      const res = new EventEmitter();
      Object.assign(res, { statusCode, headers, destruida: false });
      res.destroy = () => { res.destruida = true; };
      cb(res);
      if (!res.destruida) {
        for (const chunk of chunks) res.emit('data', chunk);
        res.emit('end');
      }
    });
    return req;
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  dns.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  https.get.mockImplementation(respuesta());
  http.get.mockImplementation(respuesta());
});

test('descarga una imagen externa sin CORS y conecta a la IP pública validada', async () => {
  expect(await descargarImagenExterna('https://cdn.example/foto.webp')).toEqual(Buffer.from('imagen'));
  expect(dns.lookup).toHaveBeenCalledWith('cdn.example', { all: true });
  const opciones = https.get.mock.calls[0][1];
  dns.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  const callback = jest.fn();
  opciones.lookup('cdn.example', {}, callback);
  expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
});

test.each([
  'http://127.0.0.1/foto.png', 'http://169.254.169.254/foto.png', 'http://10.0.0.1/foto.png',
  'http://[::1]/foto.png', 'http://[::ffff:127.0.0.1]/foto.png', 'file:///etc/passwd',
  'http://cdn.example:8080/foto.png', 'https://usuario:clave@cdn.example/foto.png',
])('rechaza destinos internos o protocolos inválidos: %s', async url => {
  await expect(descargarImagenExterna(url)).rejects.toMatchObject({ status: 422 });
  expect(http.get).not.toHaveBeenCalled();
  expect(https.get).not.toHaveBeenCalled();
});

test('rechaza DNS que mezcla IPs públicas y privadas', async () => {
  dns.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '192.168.1.1', family: 4 }]);
  await expect(descargarImagenExterna('https://cdn.example/foto.png')).rejects.toMatchObject({ status: 422 });
  expect(https.get).not.toHaveBeenCalled();
});

test('valida las redirecciones antes de seguirlas', async () => {
  https.get.mockImplementation(respuesta({ statusCode: 302, headers: { location: 'http://127.0.0.1/privado' } }));
  await expect(descargarImagenExterna('https://cdn.example/foto.png')).rejects.toMatchObject({ status: 422 });
  expect(https.get).toHaveBeenCalledTimes(1);
  expect(http.get).not.toHaveBeenCalled();
});

test('sigue una redirección pública y limita los bucles', async () => {
  https.get.mockImplementationOnce(respuesta({ statusCode: 302, headers: { location: '/otra.webp' } }));
  expect(await descargarImagenExterna('https://cdn.example/foto.png')).toEqual(Buffer.from('imagen'));
  expect(https.get.mock.calls[1][0].pathname).toBe('/otra.webp');
  https.get.mockImplementation(respuesta({ statusCode: 302, headers: { location: '/bucle' } }));
  await expect(descargarImagenExterna('https://cdn.example/foto.png')).rejects.toThrow('demasiadas veces');
});

test('rechaza contenido que no es imagen y archivos excesivos', async () => {
  https.get.mockImplementation(respuesta({ headers: { 'content-type': 'text/html' } }));
  await expect(descargarImagenExterna('https://cdn.example/foto.png')).rejects.toMatchObject({ status: 502 });
  https.get.mockImplementation(respuesta({ headers: { 'content-type': 'image/png', 'content-length': String(13 * 1024 * 1024) } }));
  await expect(descargarImagenExterna('https://cdn.example/foto.png')).rejects.toMatchObject({ status: 413 });
  https.get.mockImplementation(respuesta({ chunks: [Buffer.alloc(13 * 1024 * 1024)] }));
  await expect(descargarImagenExterna('https://cdn.example/foto.png')).rejects.toMatchObject({ status: 413 });
});
