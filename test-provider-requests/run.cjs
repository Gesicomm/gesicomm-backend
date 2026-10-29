'use strict';

// Run with Vite on localhost:5173. Uses only a disposable local PostgreSQL DB.
// Business routes, model, migration and React page are real; auth is test-only.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { Sequelize } = require('sequelize');
const { chromium } = require('../../gesicomm-frontend/node_modules/playwright');
const out = path.resolve(__dirname, '../../outputs/provider-requests-' + Date.now());
const pgBin = process.env.PROVIDER_E2E_PG_BIN || 'C:/Program Files/PostgreSQL/17/bin';
const dataDir = path.join(out, 'postgres');
const resources = {};
fs.mkdirSync(out, { recursive: true });
function pg(command, args) {
  const fd = fs.openSync(path.join(out, 'postgres.log'), 'a');
  try { execFileSync(path.join(pgBin, command + '.exe'), args, { windowsHide: true, stdio: ['ignore', fd, fd], timeout: 60000 }); }
  finally { fs.closeSync(fd); }
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function inject(relative, exports) {
  const id = require.resolve(relative);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
async function main() {
  process.env.NODE_ENV = 'test';
  const port = await freePort();
  pg('initdb', ['-D', dataDir, '-U', 'provider_e2e', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
  pg('pg_ctl', ['-D', dataDir, '-l', path.join(out, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -F`, '-w', 'start']);
  resources.pg = true;
  pg('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'provider_e2e', 'provider_e2e']);
  const db = resources.db = new Sequelize('provider_e2e', 'provider_e2e', '', { host: '127.0.0.1', port, dialect: 'postgres', logging: false });
  inject('../src/config/database', db);
  const MensajeContacto = require('../src/models/MensajeContacto');
  inject('../src/models', { MensajeContacto });
  await db.query('CREATE TABLE usuarios (id SERIAL PRIMARY KEY); INSERT INTO usuarios(id) VALUES (8)');
  await MensajeContacto.sync();
  // Reproduce the pre-migration schema and a real legacy provider message.
  for (const column of ['datos_proveedor', 'revision_proveedor', 'nota_revision', 'revisado_por', 'revisado_en']) await db.getQueryInterface().removeColumn('mensajes_contacto', column);
  await db.query(`INSERT INTO mensajes_contacto(area,nombre,email,asunto,mensaje,estado,created_at,updated_at)
    VALUES ('comercial','Proveedor anterior','anterior@example.test','Gesicom · Postulación de proveedor · Mercaderías',
    'Documento: 123456\nWhatsApp: +595981123456\nDescripción: Insumos para negocios','nuevo',NOW(),NOW())`);
  const migration = require('../migrations/20261029170000-revision-solicitudes-proveedores');
  await migration.up(db.getQueryInterface());
  await migration.up(db.getQueryInterface());
  const service = require('../src/services/solicitudProveedor.service');
  const legacy = (await service.listar()).solicitudes[0];
  assert.equal(legacy.estado, 'pendiente');
  assert.equal(legacy.datos.documento, '123456');
  console.log('PASS migration twice, original data preserved and legacy requests visible');

  const noOp = (_req, res) => res.json({});
  inject('../src/middleware/autenticacion', { verificarToken: (req, res, next) => {
    if (req.get('x-provider-test-admin') !== 'yes') return res.status(401).json({ message: 'Sin sesión de prueba' });
    req.usuario = { id: 8, rol: 'administrador' }; next();
  } });
  inject('../src/middleware/autorizacion', { verificarPermiso: () => (_req, _res, next) => next() });
  inject('../src/controllers/solicitudEliminacion.controller', Object.fromEntries(['solicitar', 'estado', 'solicitarDesdePanel', 'listar', 'actualizarEstado'].map(k => [k, noOp])));
  inject('../src/controllers/mensajeContacto.controller', { crear: noOp, listar: noOp });
  inject('../src/services/codigoPrueba.service', {});
  inject('../src/utils/logger', { auditoria: () => {} });
  const app = require('express')();
  app.use(require('express').json());
  app.use('/api/publico', require('../src/routes/publico'));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ message: err.message }));
  const server = resources.server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const api = `http://127.0.0.1:${server.address().port}`;
  const browser = resources.browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' });
  resources.page = page;
  // HMR is not part of this test; keep its socket inert across fixture reloads.
  await page.routeWebSocket('**', () => {});
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.error('Browser:', e.message); });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('solicitudes-proveedores')) {
      const response = await route.fetch({ url: api + url.pathname + url.search, headers: { ...route.request().headers(), 'x-provider-test-admin': 'yes' } });
      await route.fulfill({ response });
    } else await route.fulfill({ json: {} });
  });
  await page.goto('http://localhost:5173');
  await page.getByText('Ofrecer mis servicios', { exact: false }).first().click();
  for (const [id, value] of Object.entries({ nombre: 'Ana', apellido: 'Pérez', documento: '987654', email: 'ana@example.test', whatsapp: '+595981234567', detalle: 'Logística para tiendas y emprendedores.' })) await page.locator('#gc-p-' + id).fill(value);
  await page.locator('#gc-p-tipo').selectOption('envios');
  await page.locator('#gc-provider-form button[type=submit]').click();
  await page.getByText(/Postulación #\d+ recibida/).waitFor();
  const created = (await service.listar()).solicitudes.find(s => s.nombre === 'Ana Pérez');
  assert.ok(created);
  assert.equal(created.datos.whatsapp, '+595981234567');
  console.log('PASS real landing form -> HTTP route -> PostgreSQL');

  await page.route('**/__qa-providers', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme="light"><meta name="viewport" content="width=device-width,initial-scale=1"><body class="gc-panel"><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
    const {default:React}=await import('/node_modules/.vite-dev/deps/react.js'); const {default:ReactDOM}=await import('/node_modules/.vite-dev/deps/react-dom_client.js');
    await import('/src/index.css'); await import('/src/styles/settingsTypography.css'); await import('/src/styles/systemTypography.css'); await import('/node_modules/@fontsource-variable/plus-jakarta-sans/index.css');
    const {default:Component}=await import('/src/pages/admin/SolicitudesProveedores.jsx'); const {default:API}=await import('/src/services/api.js'); API.defaults.baseURL='/api';
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Component));
  </script></body></html>` }));
  await page.goto('http://localhost:5173/__qa-providers');
  await page.getByRole('heading', { name: 'Ana Pérez', exact: true }).waitFor();
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Ana Pérez', exact: true }) });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1050 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width}: overflow`);
      assert.equal(await card.locator('.provider-specialty').evaluate(e => getComputedStyle(e).fontSize), '16px');
      if (width === 1440 || width === 390) await page.screenshot({ path: path.join(out, `providers-${theme}-${width}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await card.getByRole('button', { name: 'Aceptar solicitud' }).click();
  await card.getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'aceptar-' + created.id);
  await card.getByRole('button', { name: 'Aceptar solicitud' }).click();
  await card.getByLabel('Nota de revisión (opcional)').fill('Cobertura y servicios verificados.');
  await card.getByRole('button', { name: 'Confirmar aceptación' }).click();
  await page.getByRole('status').filter({ hasText: 'fue aceptada' }).waitFor();
  await page.getByRole('button', { name: /Aceptadas/ }).click();
  await page.getByText('Cobertura y servicios verificados.').waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Proveedor anterior', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Rechazar', exact: true }).click();
  await page.getByLabel('Motivo del rechazo (obligatorio)').fill('La especialidad no corresponde al programa.');
  await page.getByRole('button', { name: 'Confirmar rechazo' }).click();
  await page.getByRole('status').filter({ hasText: 'fue rechazada' }).waitFor();
  await page.getByRole('button', { name: /Rechazadas/ }).click();
  await page.getByText('La especialidad no corresponde al programa.').waitFor();
  const stored = await MensajeContacto.findByPk(created.id);
  assert.equal(stored.revision_proveedor, 'aceptada'); assert.equal(stored.revisado_por, 8); assert.ok(stored.revisado_en);
  const race = await service.crear({ nombre: 'Solicitud', apellido: 'Simultánea', email: 'race@example.test', documento: '123', whatsapp: '+595981123456', categoria: 'mercaderias' });
  const decisions = await Promise.allSettled(['aceptada', 'rechazada'].map(estado => service.revisar(race.id, { estado, nota: 'Revisión simultánea' }, 8)));
  assert.equal(decisions.filter(d => d.status === 'fulfilled').length, 1);
  assert.equal(decisions.find(d => d.status === 'rejected').reason.status, 409);
  assert.deepEqual(errors, []);
  console.log('PASS accept/reject, notes, persistence, keyboard, 8 viewport/theme cases, concurrent decisions, no runtime errors');
  console.log('Screenshots:', out);
}
main().catch(async err => {
  console.error(err); process.exitCode = 1;
  if (resources.page) { console.error((await resources.page.locator('body').innerText()).slice(0, 2000)); await resources.page.screenshot({ path: path.join(out, 'failure.png') }); }
}).finally(async () => {
  if (resources.browser) await resources.browser.close();
  if (resources.server) await new Promise(resolve => resources.server.close(resolve));
  if (resources.db) await resources.db.close();
  if (resources.pg) pg('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop']);
});
