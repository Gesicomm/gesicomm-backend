'use strict';

const dns = require('dns/promises');
const http = require('http');
const https = require('https');
const { BlockList, isIP } = require('net');

const privadas = new BlockList();
for (const [red, prefijo] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
]) privadas.addSubnet(red, prefijo);
for (const [red, prefijo] of [
  ['::', 96], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) privadas.addSubnet(red, prefijo, 'ipv6');

function errorImagen(mensaje, status = 502) {
  return Object.assign(new Error(mensaje), { status });
}

async function destinoPublico(url, signal) {
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || (url.port && url.port !== '443' && url.port !== '80')) {
    throw errorImagen('La dirección de la imagen no es válida.', 422);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let alAbortar;
  const cancelacion = new Promise((resolve, reject) => {
    alAbortar = () => reject(errorImagen('La descarga de la imagen tardó demasiado.'));
    signal.addEventListener('abort', alAbortar, { once: true });
  });
  let direcciones;
  try {
    signal.throwIfAborted();
    direcciones = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await Promise.race([dns.lookup(hostname, { all: true }), cancelacion]);
  } finally {
    signal.removeEventListener('abort', alAbortar);
  }
  if (!direcciones.length || direcciones.some(d => privadas.check(d.address, d.family === 6 ? 'ipv6' : 'ipv4'))) {
    throw errorImagen('La dirección de la imagen no es pública.', 422);
  }
  return direcciones[0];
}

// Solo recibe la URL guardada en el producto del pedido autorizado. Se
// valida cada redirección y se fija la IP resuelta al abrir la conexión.
async function descargarImagenExterna(valor) {
  let url;
  try { url = new URL(valor); } catch { throw errorImagen('La dirección de la imagen no es válida.', 422); }
  const signal = AbortSignal.timeout(15000);
  const limite = 12 * 1024 * 1024;
  for (let salto = 0; salto <= 4; salto++) {
    const destino = await destinoPublico(url, signal);
    const resultado = await new Promise((resolve, reject) => {
      const cliente = url.protocol === 'https:' ? https : http;
      const req = cliente.get(url, {
        agent: false, signal, autoSelectFamily: false,
        lookup: (host, opciones, cb) => opciones.all ? cb(null, [destino]) : cb(null, destino.address, destino.family),
        headers: { Accept: 'image/*' },
      }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.destroy();
          resolve({ location: res.headers.location });
          return;
        }
        if (res.statusCode !== 200 || !String(res.headers['content-type'] || '').toLowerCase().startsWith('image/')) {
          res.destroy();
          reject(errorImagen('No se pudo descargar la imagen del producto.'));
          return;
        }
        if (Number(res.headers['content-length']) > limite) {
          res.destroy();
          reject(errorImagen('La imagen del producto es demasiado grande.', 413));
          return;
        }
        const chunks = [];
        let bytes = 0;
        res.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > limite) {
            reject(errorImagen('La imagen del producto es demasiado grande.', 413));
            res.destroy();
            req.destroy();
          } else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
    });
    if (resultado.buffer) return resultado.buffer;
    url = new URL(resultado.location, url);
  }
  throw errorImagen('La imagen redirige demasiadas veces.');
}

module.exports = { descargarImagenExterna };
