import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validar, rutas, estimar } from './modelo.mjs';

const tienda = { origen: 'https://carga.test', categoria: 'Audio, TV y video', producto: 'air-fryer' };
const produccion = { entorno: 'produccion', eventos: false, tiendas: [tienda] };

test('300 visitantes por 50 tiendas son 15000 y requieren unas 1350 llamadas API/s con este ritmo', () => {
  assert.deepEqual(estimar(50, 300), { visitantes: 15000, paginasSegundo: 500, lecturasSegundo: 500, eventosSegundo: 850, apiSegundo: 1350 });
});

test('producción solo permite la comprobación acotada sin eventos', () => {
  const etapas = validar(produccion, 'canary');
  assert.equal(Math.max(...etapas.map(e => e.usuarios)), 5);
  assert.equal(etapas.reduce((n, e) => n + e.usuarios * 3, 0), 27);
  for (const perfil of ['tienda300', 'tienda1000', 'tiendas50']) assert.throws(() => validar(produccion, perfil));
  assert.throws(() => validar({ ...produccion, eventos: true }, 'canary'));
});

test('la carga completa exige 50 identidades y eventos en un entorno aislado con CAPI desactivada', () => {
  const aislado = { entorno: 'aislado', eventos: true, metaCapiDesactivada: true, tiendas: [tienda] };
  assert.throws(() => validar(aislado, 'tiendas50'));
  const tiendas = Array.from({ length: 50 }, (_, i) => ({ ...tienda, host: `carga-${i}.test` }));
  assert.equal(validar({ ...aislado, tiendas }, 'tiendas50').at(-1).usuarios, 15000);
  assert.throws(() => validar({ ...aislado, tiendas: [...tiendas.slice(0, 49), tiendas[0]] }, 'tiendas50'));
  assert.throws(() => validar({ ...aislado, eventos: false }, 'tienda300'));
});

test('las URLs conservan categoría, slug y tamaño de página sin variar la clave de caché por visitante', () => {
  const camino = rutas({ ...tienda, slug: 'mi tienda' });
  const url = new URL(camino.categoria, tienda.origen);
  assert.equal(url.pathname, '/api/l/mi%20tienda/');
  assert.equal(url.searchParams.get('categoria'), tienda.categoria);
  assert.equal(url.searchParams.get('porPagina'), '25');
  assert.equal(url.searchParams.get('soloDatos'), 'true');
  assert.equal(camino.producto, '/api/l/mi%20tienda/producto/air-fryer');
});

test('un 429 detiene la ejecución real antes de generar más carga y no se registra como capacidad suficiente', async () => {
  const directorio = await mkdtemp(join(tmpdir(), 'gesicomm-carga-'));
  const peticiones = [];
  const servidor = createServer((req, res) => {
    peticiones.push(req.method);
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  try {
    const manifiesto = join(directorio, 'tiendas.json');
    const salida = join(directorio, 'resultado.json');
    await writeFile(manifiesto, JSON.stringify({ ...produccion, tiendas: [{ ...tienda, origen: `http://127.0.0.1:${servidor.address().port}` }] }));
    const codigo = await new Promise((resolve, reject) => {
      const hijo = spawn(process.execPath, [fileURLToPath(new URL('./ejecutar.mjs', import.meta.url)), '--manifiesto', manifiesto, '--salida', salida], { stdio: 'ignore' });
      hijo.once('error', reject);
      hijo.once('exit', resolve);
    });
    const resultado = JSON.parse(await readFile(salida, 'utf8'));
    assert.equal(codigo, 1);
    assert.equal(resultado.estado, 'detenido');
    assert.match(resultado.motivo, /429/);
    assert.deepEqual(peticiones, ['GET']);
  } finally {
    await new Promise(resolve => servidor.close(resolve));
    assert.ok(resolve(directorio).startsWith(resolve(tmpdir()) + sep + 'gesicomm-carga-'));
    await rm(directorio, { recursive: true, force: true });
  }
});
