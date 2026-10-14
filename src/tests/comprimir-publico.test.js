'use strict';

const http = require('http');
const express = require('express');
const { gunzipSync, brotliDecompressSync } = require('zlib');
const comprimirPublico = require('../middleware/comprimirPublico');

describe('Compresión de respuestas públicas', () => {
  let server;
  const payload = { codigo: '<main>Diseño publicado</main>'.repeat(300), precio: 120000 };

  beforeAll(async () => {
    const app = express();
    app.use('/api/l', comprimirPublico);
    app.get('/api/l/:vista', (req, res) => {
      res.set('Cache-Control', req.params.vista === 'preview'
        ? 'private, no-store' : 'public, max-age=0, s-maxage=60');
      res.json(req.params.vista === 'vacio' ? { disponible: false } : payload);
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
  });
  afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

  function pedir(vista, encoding) {
    return new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port: server.address().port,
        path: `/api/l/${vista}`, headers: { 'Accept-Encoding': encoding } }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
  }

  test('reduce bytes y conserva el JSON, precio, caché y negociación', async () => {
    const { headers, body } = await pedir('home', 'gzip');
    expect(headers['content-encoding']).toBe('gzip');
    expect(headers.vary).toContain('Accept-Encoding');
    expect(headers['cache-control']).toContain('s-maxage=60');
    expect(body.length).toBeLessThan(Buffer.byteLength(JSON.stringify(payload)) / 2);
    expect(JSON.parse(gunzipSync(body).toString())).toEqual(payload);
  });
  test('el preview comprimido sigue siendo privado', async () => {
    const { headers } = await pedir('preview', 'gzip');
    expect(headers['content-encoding']).toBe('gzip');
    expect(headers['cache-control']).toBe('private, no-store');
  });
  test('negocia Brotli en navegadores que lo soportan y conserva el contenido', async () => {
    const { headers, body } = await pedir('home', 'br, gzip');
    expect(headers['content-encoding']).toBe('br');
    expect(JSON.parse(brotliDecompressSync(body).toString())).toEqual(payload);
  });
  test('un cliente sin soporte de gzip recibe JSON normal', async () => {
    const { headers, body } = await pedir('home', 'identity');
    expect(headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(body.toString())).toEqual(payload);
  });
  test('no comprime respuestas pequeñas', async () => {
    const { headers, body } = await pedir('vacio', 'gzip');
    expect(headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(body.toString())).toEqual({ disponible: false });
  });
});
