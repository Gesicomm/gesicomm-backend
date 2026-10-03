'use strict';

// This runner owns a fresh PostgreSQL cluster. It never uses DB_* from .env.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');

const backend = path.resolve(__dirname, '..');
const frontend = path.resolve(process.env.SPEEDBOX_E2E_FRONTEND || path.join(backend, '..', 'speedbox-frontend'));
const pgBin = process.env.SPEEDBOX_E2E_PG_BIN || 'C:\\Program Files\\PostgreSQL\\17\\bin';
const artifacts = path.resolve(process.env.SPEEDBOX_E2E_ARTIFACTS || path.join(backend, '..', 'tmp', `speedbox-e2e-${Date.now()}`));
const dataDir = path.join(artifacts, 'postgres');
const nativeFetch = global.fetch;
const report = { started_at: new Date().toISOString(), scope: 'real browser + production routes/services + disposable PostgreSQL + local HTTP Speedbox simulator', steps: [], artifacts };
const resources = { servers: [] };
const previewMode = process.argv.includes('--preview');
const remote = { calls: [], orders: [], updates: [], next: null, failNext: false };

function pg(command, args) {
  // PostgreSQL's Windows children inherit pipe handles, preventing sync exit.
  const output = fs.openSync(path.join(artifacts, 'postgres-commands.log'), 'a');
  try {
    return execFileSync(path.join(pgBin, `${command}${process.platform === 'win32' ? '.exe' : ''}`), args, { windowsHide: true, encoding: 'utf8', stdio: ['ignore', output, output], timeout: 60000 });
  } finally { fs.closeSync(output); }
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function listen(app) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  resources.servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
async function step(name, fn) {
  const start = Date.now();
  try {
    const evidence = await fn();
    report.steps.push({ name, status: 'passed', milliseconds: Date.now() - start, evidence });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.steps.push({ name, status: 'failed', milliseconds: Date.now() - start, error: error.stack });
    throw error;
  }
}
async function waitFor(url) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (resources.vite?.exitCode != null) throw new Error('Vite exited; inspect vite.log.');
    try { if ((await nativeFetch(url)).ok) return; } catch { /* Startup is asynchronous. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not start: ${url}`);
}

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const dbPort = await freePort();
  const dbName = `gesicomm_speedbox_e2e_${crypto.randomBytes(4).toString('hex')}`;
  await step('01 Fresh isolated PostgreSQL cluster', async () => {
    pg('initdb', ['-D', dataDir, '-U', 'speedbox_e2e', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
    pg('pg_ctl', ['-D', dataDir, '-l', path.join(artifacts, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${dbPort} -F`, '-w', 'start']);
    resources.pgStarted = true;
    pg('createdb', ['-h', '127.0.0.1', '-p', String(dbPort), '-U', 'speedbox_e2e', dbName]);
    return { host: '127.0.0.1', port: dbPort, database: dbName, data_directory: dataDir };
  });
  Object.assign(process.env, {
    NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: String(dbPort), DB_NAME: dbName,
    DB_USER: 'speedbox_e2e', DB_PASSWORD: '', JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    REFRESH_TOKEN_SECRET: crypto.randomBytes(32).toString('hex'),
    SPEEDBOX_ENABLED: 'false', SPEEDBOX_ENVIRONMENT: 'sandbox',
    SPEEDBOX_API_URL: 'https://speedboxpy.com/api/speedbox_sandbox.php',
    SPEEDBOX_API_KEY: 'e2e-dummy-key', SPEEDBOX_API_SECRET: 'e2e-dummy-secret',
    SMTP_USER: '', SMTP_PASS: '', BREVO_API_KEY: '', BREVO_ADMIN_EMAIL: '', BREVO_FROM_EMAIL: '',
    SPEEDBOX_REGISTRATION_URL: 'https://registration.example.test/register',
    SPEEDBOX_WEBHOOK_TOKEN: crypto.randomBytes(32).toString('hex'),
  });
  const express = require('express');
  const simulator = express();
  simulator.use(express.json());
  simulator.all('/api/speedbox_sandbox.php', (req, res) => {
    if (req.headers.authorization !== 'Bearer e2e-dummy-key' || req.headers['x-api-secret'] !== 'e2e-dummy-secret') return res.status(401).json({ ok: false });
    remote.calls.push({ action: req.query.action, method: req.method, since_at: req.query.since_at, body: req.body });
    if (req.query.action === 'spec') return res.json({ ok: true, spec: {} });
    if (req.query.action === 'store') return res.json({ ok: true, tienda_id: '54' });
    if (req.query.action === 'updates') return res.json({ ok: true, events: remote.updates, next_since_at: remote.next || new Date().toISOString() });
    if (req.query.action === 'order') {
      if (remote.failNext) { remote.failNext = false; return res.status(500).json({ ok: false, error: 'Injected E2E failure' }); }
      const order = { external_order_id: req.body.external_order_id, order_id: String(900000000123456n + BigInt(remote.orders.length)), order_name: req.body.order_name, status: 'pendiente_confirmacion', confirmed: false, spb_code: null };
      remote.orders.push({ order, payload: req.body });
      return res.status(201).json({ ok: true, order });
    }
    return res.status(400).json({ ok: false });
  });
  const simulatorUrl = await listen(simulator);
  // Intercept only the external transport in this process, not production code.
  global.fetch = (input, options) => {
    const url = new URL(String(input));
    if (url.origin === 'https://speedboxpy.com' && url.pathname === '/api/speedbox_sandbox.php') return nativeFetch(`${simulatorUrl}${url.pathname}${url.search}`, options);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error(`External network blocked by E2E runner: ${url.hostname}`);
    return nativeFetch(input, options);
  };
  const m = require('../src/models');
  resources.sequelize = m.sequelize;
  m.sequelize.options.logging = false;
  await step('02 Real schema and Speedbox migration (twice)', async () => {
    // Sequelize's cyclic-FK sync emits invalid ENUM USING SQL with comments.
    // Omit only DDL comments while bootstrapping this brand-new test database.
    const comments = [];
    for (const model of Object.values(m.sequelize.models)) {
      for (const attribute of Object.values(model.rawAttributes)) {
        if (attribute.comment) { comments.push([attribute, attribute.comment]); delete attribute.comment; }
      }
      model.refreshAttributes();
    }
    try { await m.sequelize.sync(); }
    finally {
      for (const [attribute, comment] of comments) attribute.comment = comment;
      for (const model of Object.values(m.sequelize.models)) model.refreshAttributes();
    }
    const qi = m.sequelize.getQueryInterface();
    const migration = require('../migrations/20261002150000-speedbox-integration');
    // Only these empty test tables are dropped, so up exercises table creation.
    await migration.down(qi);
    await migration.up(qi, require('sequelize'));
    await migration.up(qi, require('sequelize'));
    const abastecimientoMigration = require('../migrations/20261002200000-speedbox-abastecimiento');
    await m.sequelize.query('ALTER TABLE envios ALTER COLUMN abastecimiento_estado TYPE VARCHAR(30)');
    await abastecimientoMigration.up(qi, require('sequelize'));
    await abastecimientoMigration.up(qi, require('sequelize'));
    await require('../scripts/migrar-numero-pedido').migrarNumeroPedido();
    return { tables: (await qi.showAllTables()).length, migration_idempotent: true };
  });
  const inquilino = await m.Inquilino.create({ nombre: 'Speedbox E2E tenant' });
  const rol = await m.Rol.create({ nombre: 'usuario' });
  const permiso = await m.Permiso.create({ nombre: 'gestionar_tienda' });
  await rol.addPermiso(permiso);
  const password = 'E2E-Test-Only-2026!';
  const hash = await require('bcryptjs').hash(password, 4);
  const user = await m.Usuario.create({ nombre: 'Comercio E2E', correo_electronico: 'speedbox-e2e@example.test', contrasena_hash: hash, email_verificado: true, inquilino_id: inquilino.id, rol_id: rol.id });
  const other = await m.Usuario.create({ nombre: 'Otra tienda', correo_electronico: 'other-e2e@example.test', contrasena_hash: hash, email_verificado: true, inquilino_id: inquilino.id, rol_id: rol.id });
  const adminRole = await m.Rol.create({ nombre: 'ADMIN' });
  const admin = await m.Usuario.create({ nombre: 'Admin E2E', correo_electronico: 'admin-e2e@example.test', contrasena_hash: hash, email_verificado: true, inquilino_id: inquilino.id, rol_id: adminRole.id });
  await m.Tienda.create({ usuario_id: user.id, inquilino_id: inquilino.id, nombre: 'Tienda E2E', subdominio: 'speedbox-e2e', documento: '1234567', ruc: '80000000-0' });
  const plan = await m.Plan.create({ codigo: 'e2e', nombre: 'Pro E2E', precio: 10000, features: ['tienda'] });
  await m.Suscripcion.create({ usuario_id: user.id, plan_id: plan.id, email: user.correo_electronico, estado: 'activa', precio_pagado: 10000, periodo_inicio: new Date(), periodo_fin: new Date(Date.now() + 86400000 * 30) });
  const courier = await m.Courier.create({ usuario_id: user.id, nombre: 'Speedbox E2E', activo: true });
  const alternate = await m.Courier.create({ usuario_id: user.id, nombre: 'Otro courier E2E', activo: true });
  const payment = await m.MetodoPago.create({ usuario_id: user.id, nombre: 'Contra entrega E2E', custodia_cobro: 'courier' });
  const product = await m.Producto.create({ inquilino_id: inquilino.id, creado_por: user.id, nombre: 'Producto Speedbox E2E', slug: 'producto-speedbox-e2e', sku: 'SKU-001', precio_base: 85000, precio_costo: 40000, stock_salon: 100, stock_deposito: 0, cantidad_disponible: 100 });
  const app = express();
  app.use(require('cors')({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(require('cookie-parser')());
  for (const [mount, file] of [['auth', 'auth'], ['mi-tienda', 'tienda'], ['couriers', 'courierRoutes'], ['envios', 'envioRoutes'], ['solicitudes-abastecimiento', 'solicitudAbastecimientoRoutes'], ['inventario', 'inventarioRoutes'], ['integraciones/speedbox', 'speedbox'], ['webhooks', 'webhooks']]) app.use(`/api/${mount}`, require(`../src/routes/${file}`));
  app.use('/api', require('../src/routes/suscripciones'));
  app.get('/api/educacion/progreso-sidebar', (req, res) => res.json({ menusDesbloqueados: [], bloqueos: {} }));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  const api = await listen(app);
  const frontendPort = await freePort();
  const preview = `http://127.0.0.1:${frontendPort}`;
  resources.preview = { url: preview, api, email: user.correo_electronico, password };
  resources.app = app;
  const viteLog = fs.createWriteStream(path.join(artifacts, 'vite.log'));
  resources.viteLog = viteLog;
  resources.vite = spawn(process.execPath, [path.join(frontend, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], { cwd: frontend, env: { ...process.env, VITE_API_URL: `${api}/api` }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  resources.vite.stdout.pipe(viteLog);
  resources.vite.stderr.pipe(viteLog);
  await waitFor(preview);
  const { chromium, expect } = require(require.resolve('@playwright/test', { paths: [frontend] }));
  resources.browser = await chromium.launch({ headless: true });
  const context = await resources.browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  resources.page = page;
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return ['127.0.0.1', 'localhost'].includes(host) ? route.continue() : route.abort();
  });
  async function request(method, endpoint, data, expected = 200, requestContext = context.request) {
    const response = await requestContext[method](`${api}/api/${endpoint}`, { data });
    const body = await response.json();
    assert.equal(response.status(), expected, `${method} ${endpoint}: ${JSON.stringify(body)}`);
    return body;
  }
  async function stock() {
    await product.reload();
    return { available: product.cantidad_disponible, reserved: product.cantidad_reservada, transit: product.cantidad_transito };
  }
  async function order(extra = {}) {
    return request('post', 'envios', { nombre_cliente: 'Cliente', apellido_cliente: 'E2E', telefono: '0981000000', ciudad: 'Asuncion', departamento: 'Central', direccion: 'Mariscal Lopez 1234', referencia: 'Frente a la plaza', link_maps: 'https://maps.google.com/?q=Asuncion', courier_id: courier.id, metodo_pago_id: payment.id, monto: 85000, items: [{ producto_id: product.id, nombre_producto: product.nombre, cantidad: 1, precio_unitario: 85000 }], ...extra }, 201);
  }
  const webhook = payload => request('post', `webhooks/speedbox?environment=sandbox&token=${process.env.SPEEDBOX_WEBHOOK_TOKEN}`, payload);
  const event = (orderId, status, id, offset = 0) => ({ event: 'shipment.status_changed', event_id: id, occurred_at: new Date(Date.now() + offset).toISOString(), data: { order_id: orderId, tienda_id: 54, status } });
  let first;
  await step('03 Real login, HttpOnly cookie and browser panel', async () => {
    await request('post', 'auth/login', { email: user.correo_electronico, password });
    assert.equal((await request('get', 'suscripciones/mi-estado')).tiene_suscripcion_activa, true);
    assert.equal((await request('get', 'mi-tienda')).usuario_id, user.id);
    assert((await context.cookies()).some(cookie => cookie.name === 'accessToken' && cookie.httpOnly));
    await page.goto(`${preview}/mi-tienda?tab=speedbox`);
    await expect(page.getByLabel('Courier Speedbox')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Crear cuenta en Speedy' })).toHaveAttribute('href', 'https://registration.example.test/register');
    return { login: 'production auth route, real bcrypt and JWT', screenshot: 'desktop.png (captured below)' };
  });
  await step('04 Browser spec, store association, courier selection and activation', async () => {
    await page.getByRole('button', { name: 'Probar conexion', exact: true }).click();
    await expect(page.getByText('Autenticacion verificada.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Vincular tienda', exact: true }).click();
    await expect(page.getByText('Tienda vinculada.', { exact: true })).toBeVisible();
    await page.getByLabel('Courier Speedbox').selectOption(String(courier.id));
    await page.getByLabel('Integración activa').check();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Configuracion guardada.', { exact: true })).toBeVisible();
    const state = await request('get', 'integraciones/speedbox');
    assert.equal(state.connection.tienda_id, '54');
    assert.equal(state.connection.activo, true);
    assert(!JSON.stringify(state).includes('e2e-dummy-secret'));
    await request('post', 'integraciones/speedbox/store');
    assert.equal(remote.calls.filter(call => call.action === 'store').length, 1);
    return { tienda_id: '54', store_create_calls: 1, credentials_absent_from_response: true };
  });
  await step('05 Confirmed order via real API reserves stock and browser sends real HTTP', async () => {
    first = await order();
    assert.deepEqual(await stock(), { available: 99, reserved: 1, transit: 0 });
    await page.getByRole('button', { name: 'Actualizar panel', exact: true }).click();
    await page.getByLabel('Pedido confirmado').selectOption(String(first.id));
    await page.getByRole('button', { name: 'Enviar pedido', exact: true }).click();
    await expect(page.getByText('Pedido enviado.', { exact: true })).toBeVisible();
    assert.equal(remote.orders.length, 1);
    assert.equal(remote.orders[0].payload.items[0].sku, 'SKU-001');
    assert.equal(remote.orders[0].payload.total_price, 85000);
    first.remoteId = remote.orders[0].order.order_id;
    await expect(page.getByText(first.remoteId, { exact: true })).toBeVisible();
    return { envio_id: first.id, numero_pedido: first.numero_pedido, remote_id: first.remoteId, payload: remote.orders[0].payload, stock: await stock() };
  });
  await step('06 Resending an already linked order is idempotent', async () => {
    await request('post', `integraciones/speedbox/pedidos/${first.id}/enviar`);
    assert.equal(remote.orders.length, 1);
    return { remote_order_posts: remote.calls.filter(call => call.action === 'order').length };
  });
  await step('07 Unknown token and malformed webhook are rejected', async () => {
    await request('post', 'webhooks/speedbox?environment=sandbox&token=invalid', event(first.remoteId, 'cargado', 'bad-token'), 401);
    await request('post', `webhooks/speedbox?environment=sandbox&token=${process.env.SPEEDBOX_WEBHOOK_TOKEN}`, event(first.remoteId, 'unsupported', 'bad-state'), 400);
    assert.equal(await m.SpeedboxEvento.count(), 0);
    return { http_statuses: [401, 400], inserted_events: 0 };
  });
  await step('08 Webhook cargado prepares the order without duplicating stock reservation', async () => {
    await webhook(event(first.remoteId, 'cargado', 'evt-cargado'));
    assert.equal((await m.Envio.findByPk(first.id)).estado, 'Preparado');
    assert.deepEqual(await stock(), { available: 99, reserved: 1, transit: 0 });
    return { estado: 'Preparado', stock: await stock() };
  });
  const dispatch = event('placeholder', 'en_camino', 'evt-dispatch', 1000);
  dispatch.data.order_id = first.remoteId;
  await step('09 Concurrent duplicate en_camino webhook applies once', async () => {
    await Promise.all([webhook(dispatch), webhook(dispatch), webhook(dispatch)]);
    assert.equal(await m.SpeedboxEvento.count({ where: { event_key: 'id:evt-dispatch' } }), 1);
    assert.equal((await m.Envio.findByPk(first.id)).estado, 'Despachado');
    assert.deepEqual(await stock(), { available: 99, reserved: 0, transit: 1 });
    return { duplicate_requests: 3, stored_events: 1, stock: await stock() };
  });
  await step('10 Updates delivers order and records wallet movement/cursor', async () => {
    remote.next = new Date(Date.now() + 5000).toISOString();
    remote.updates = [event(first.remoteId, 'entregado', 'evt-delivered', 2000), { type: 'wallet.transaction', event_id: 'evt-wallet', occurred_at: new Date().toISOString(), tienda_id: 54, payload: { amount: 85000, direction: 'credit', currency: 'PYG' } }];
    await page.getByRole('button', { name: 'Consultar novedades', exact: true }).click();
    await expect(page.getByText('Novedades sincronizadas.', { exact: true })).toBeVisible();
    assert.equal((await m.Envio.findByPk(first.id)).estado, 'Entregado');
    assert.deepEqual(await stock(), { available: 99, reserved: 0, transit: 0 });
    const state = await request('get', 'integraciones/speedbox');
    assert.equal(state.connection.since_at, remote.next);
    assert.deepEqual(state.checks, { spec: true, order: true, updates: true, webhook: true });
    assert.equal(state.events.find(row => row.tipo === 'wallet.transaction').estado, 'procesado');
    return { estado: 'Entregado', stock: await stock(), cursor: remote.next, checks: state.checks, wallet_amount: 85000 };
  });
  await step('11 Replaying updates and late webhook cannot regress delivered order', async () => {
    await request('post', 'integraciones/speedbox/updates');
    assert.equal(remote.calls.filter(call => call.action === 'updates').at(-1).since_at, remote.next);
    assert.equal(await m.SpeedboxEvento.count({ where: { event_key: 'id:evt-wallet' } }), 1);
    await webhook(event(first.remoteId, 'cargado', 'evt-stale', -10000));
    assert.equal((await m.Envio.findByPk(first.id)).estado, 'Entregado');
    assert.deepEqual(await stock(), { available: 99, reserved: 0, transit: 0 });
    return { wallet_rows: 1, stale_event: (await m.SpeedboxEvento.findOne({ where: { event_key: 'id:evt-stale' } })).estado };
  });
  await step('12 Cancellation, deletion and courier change blocked after submission', async () => {
    const locked = await order();
    await request('post', `integraciones/speedbox/pedidos/${locked.id}/enviar`);
    await request('put', `envios/${locked.id}/estado`, { estado: 'Cancelado' }, 409);
    await request('put', `envios/${locked.id}/estado`, { courier_id: alternate.id }, 409);
    await request('delete', `envios/${locked.id}`, undefined, 403);
    const adminContext = await resources.browser.newContext();
    try {
      await request('post', 'auth/login', { email: admin.correo_electronico, password }, 200, adminContext.request);
      await request('delete', `envios/${locked.id}`, undefined, 409, adminContext.request);
    } finally { await adminContext.close(); }
    assert.equal((await m.Envio.findByPk(locked.id)).estado, 'Confirmado');
    return { http_statuses: { cancellation: 409, courier_change: 409, user_deletion: 403, admin_deletion: 409 }, stock: await stock() };
  });
  await step('13 Isolated user cannot read or send another user order', async () => {
    const otherContext = await resources.browser.newContext();
    try {
      await request('post', 'auth/login', { email: other.correo_electronico, password }, 200, otherContext.request);
      const otherState = await request('get', 'integraciones/speedbox', undefined, 200, otherContext.request);
      assert.equal(otherState.orders.length, 0);
      assert.equal(otherState.events.length, 0);
      await request('post', `integraciones/speedbox/pedidos/${first.id}/enviar`, undefined, 409, otherContext.request);
      return { visible_orders: 0, visible_events: 0, submission_status: 409 };
    } finally { await otherContext.close(); }
  });
  await step('14 Automatic cycle selects only newly confirmed matching courier orders', async () => {
    const automatic = await order();
    const excluded = await order({ courier_id: alternate.id });
    const pending = await order({ estado: 'Pendiente' });
    remote.updates = [];
    process.env.SPEEDBOX_ENABLED = 'true';
    try { await require('../src/services/speedbox/service').runCycle(); }
    finally { process.env.SPEEDBOX_ENABLED = 'false'; }
    assert.equal((await m.SpeedboxPedido.findOne({ where: { envio_id: automatic.id } })).estado, 'enviado');
    assert.equal(await m.SpeedboxPedido.count({ where: { envio_id: excluded.id } }), 0);
    assert.equal(await m.SpeedboxPedido.count({ where: { envio_id: pending.id } }), 0);
    return { sent: automatic.id, excluded_other_courier: excluded.id, excluded_pending: pending.id };
  });
  let uncertain;
  await step('15 HTTP 500 preserves uncertain submission; retry requires explicit acknowledgement', async () => {
    uncertain = await order();
    remote.failNext = true;
    await request('post', `integraciones/speedbox/pedidos/${uncertain.id}/enviar`, undefined, 502);
    const mapping = await m.SpeedboxPedido.findOne({ where: { envio_id: uncertain.id } });
    assert.equal(mapping.estado, 'incierto');
    uncertain.externalId = mapping.external_order_id;
    uncertain.originalPayload = mapping.request_payload;
    await request('post', `integraciones/speedbox/pedidos/${uncertain.id}/reintentar`, {}, 409);
    await page.getByRole('button', { name: 'Actualizar panel', exact: true }).click();
    await page.getByRole('button', { name: `Reintentar pedido ${uncertain.id}`, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Reintentar', exact: true })).toBeDisabled();
    await page.screenshot({ path: path.join(artifacts, 'retry-desktop.png') });
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Reintentar', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await mapping.reload();
    assert.equal(mapping.estado, 'enviado');
    assert.equal(mapping.intentos, 2);
    assert.equal(mapping.external_order_id, uncertain.externalId);
    assert.deepEqual(mapping.request_payload, uncertain.originalPayload);
    return { external_id: mapping.external_order_id, attempts: 2, original_payload_preserved: true };
  });
  await step('16 Return without dispatch event requires inspection, not automatic restocking', async () => {
    const returned = await order();
    const mapping = await request('post', `integraciones/speedbox/pedidos/${returned.id}/enviar`);
    const before = await stock();
    const result = await webhook(event(mapping.order_id, 'devuelto', 'evt-returned', 4000));
    const saved = await m.Envio.findByPk(returned.id);
    assert.equal(saved.estado, 'Despachado');
    assert.equal(saved.estado_logistico, 'Devuelto');
    assert.equal(result.estado, 'revision');
    const after = await stock();
    assert.equal(after.available, before.available);
    assert.equal(after.reserved, before.reserved - 1);
    assert.equal(after.transit, before.transit + 1);
    const item = await m.EnvioItem.findOne({ where: { envio_id: returned.id } });
    const component = await m.EnvioItemComponente.findOne({ where: { envio_item_id: item.id } });
    const inspection = { items: [{ envio_item_componente_id: component.id, cantidad: 1, condicion: 'vendible' }], marcar_estado: true };
    await request('post', `envios/${returned.id}/devolucion`, inspection);
    assert.equal((await m.Envio.findByPk(returned.id)).estado, 'Devuelto');
    const inspected = await stock();
    assert.equal(inspected.available, before.available + 1);
    assert.equal(inspected.transit, before.transit);
    await request('post', `envios/${returned.id}/devolucion`, inspection, 400);
    assert.deepEqual(await stock(), inspected);
    return { before_inspection_estado: saved.estado, estado_logistico: saved.estado_logistico, event: result.estado, before, after_webhook: after, after_inspection: inspected, duplicate_inspection_status: 400 };
  });
  await step('17 Failed updates page keeps cursor; replay commits without duplicate movements', async () => {
    const connection = await m.SpeedboxTienda.findOne({ where: { usuario_id: user.id } });
    const cursor = connection.since_at;
    remote.next = new Date(Date.now() + 10000).toISOString();
    remote.updates = [{ type: 'wallet.transaction', event_id: 'evt-wallet-replay', tienda_id: 54, payload: { amount: 5000, direction: 'debit', currency: 'PYG' } }, event(first.remoteId, 'invalid', 'evt-invalid')];
    await request('post', 'integraciones/speedbox/updates', undefined, 400);
    await connection.reload();
    assert.equal(connection.since_at, cursor);
    remote.updates.pop();
    await request('post', 'integraciones/speedbox/updates');
    assert.equal(await m.SpeedboxEvento.count({ where: { event_key: 'id:evt-wallet-replay' } }), 1);
    await connection.reload();
    assert.equal(connection.since_at, remote.next);
    return { failed_page_cursor: cursor, replay_cursor: connection.since_at, wallet_rows: 1 };
  });
  await step('18 Missing SKU is a durable validation error; corrected manual retry succeeds', async () => {
    const invalid = await order();
    const beforeCalls = remote.calls.filter(call => call.action === 'order').length;
    await product.update({ sku: null });
    await request('post', `integraciones/speedbox/pedidos/${invalid.id}/enviar`, undefined, 422);
    const mapping = await m.SpeedboxPedido.findOne({ where: { envio_id: invalid.id } });
    assert.equal(mapping.estado, 'error');
    assert.equal(remote.calls.filter(call => call.action === 'order').length, beforeCalls);
    await product.update({ sku: 'SKU-001' });
    await request('post', `integraciones/speedbox/pedidos/${invalid.id}/reintentar`, {});
    await mapping.reload();
    assert.equal(mapping.estado, 'enviado');
    return { initial_status: 422, remote_calls_before_correction: 0, after_correction: mapping.estado };
  });
  await step('19 Event arrives before order ID association and is reconciled later', async () => {
    const early = await order();
    const nextId = String(900000000123456n + BigInt(remote.orders.length));
    const pendingEvent = event(nextId, 'en_camino', 'evt-before-mapping', 12000);
    assert.equal((await webhook(pendingEvent)).estado, 'pendiente');
    const mapping = await request('post', `integraciones/speedbox/pedidos/${early.id}/enviar`);
    assert.equal(mapping.order_id, nextId);
    await require('../src/services/speedbox/events').retryPending();
    assert.equal((await m.Envio.findByPk(early.id)).estado, 'Despachado');
    assert.equal((await m.SpeedboxEvento.findOne({ where: { event_key: 'id:evt-before-mapping' } })).estado, 'procesado');
    return { before_mapping: 'pendiente', after_mapping: 'procesado', estado: 'Despachado' };
  });
  await step('20 Wallet update without event_id is deduplicated as a review observation', async () => {
    const beforeCount = await m.SpeedboxEvento.count();
    remote.next = new Date(Date.now() + 15000).toISOString();
    remote.updates = [{ type: 'wallet.transaction', tienda_id: 54, payload: { amount: 7000, direction: 'credit', currency: 'PYG' } }];
    await request('post', 'integraciones/speedbox/updates');
    await request('post', 'integraciones/speedbox/updates');
    assert.equal(await m.SpeedboxEvento.count(), beforeCount + 1);
    const observation = await m.SpeedboxEvento.findOne({ where: { tipo: 'wallet.transaction', estado: 'revision' } });
    assert(observation.event_key.startsWith('hash:'));
    assert.equal(observation.usuario_id, user.id);
    assert.equal((await m.Envio.findByPk(first.id)).estado_financiero, 'pendiente_liquidacion');
    return { observations_after_two_queries: 1, estado: 'revision', local_financial_status: 'pendiente_liquidacion' };
  });
  await step('21 Pending order created before activation sends immediately on confirmation, even with procurement pending', async () => {
    const waiting = await order({ estado: 'Pendiente' });
    await m.Envio.update({ created_at: new Date(Date.now() - 86400000) }, { where: { id: waiting.id } });
    await product.update({ creado_por: null });
    process.env.SPEEDBOX_ENABLED = 'true';
    try {
      const confirmed = await request('put', `envios/${waiting.id}/estado`, { estado: 'Confirmado' });
      assert.equal(confirmed.estado, 'Confirmado');
      await expect.poll(async () => (await m.SpeedboxPedido.findOne({ where: { envio_id: waiting.id } }))?.estado, { timeout: 10000 }).toBe('enviado');
      assert.equal((await m.Envio.findByPk(waiting.id)).abastecimiento_estado, 'pendiente_pago');
      assert.equal(remote.calls.filter(call => call.action === 'order' && call.body.external_order_id === `GESICOMM-sandbox-${user.id}-${waiting.id}`).length, 1);
      return { envio_id: waiting.id, estado_speedbox: 'enviado', abastecimiento_estado: 'pendiente_pago', waited_for_cron: false };
    } finally { process.env.SPEEDBOX_ENABLED = 'false'; await product.update({ creado_por: user.id }); }
  });
  await step('22 Transaction rollback removes outbox; recovery sends committed old orders', async () => {
    const deferred = await order();
    await m.Envio.update({ created_at: new Date(Date.now() - 86400000) }, { where: { id: deferred.id } });
    const envio = await m.Envio.findByPk(deferred.id);
    const service = require('../src/services/speedbox/service');
    const count = remote.calls.filter(call => call.action === 'order').length;
    process.env.SPEEDBOX_ENABLED = 'true';
    try {
      const rolledBack = await m.sequelize.transaction();
      try { await service.queueConfirmedOrder(envio, rolledBack); }
      finally { await rolledBack.rollback(); }
      assert.equal(await m.SpeedboxPedido.count({ where: { envio_id: deferred.id } }), 0);
      assert.equal(remote.calls.filter(call => call.action === 'order').length, count);
      const committed = await m.sequelize.transaction();
      try {
        await service.queueConfirmedOrder(envio, committed);
        process.env.SPEEDBOX_ENABLED = 'false';
        await committed.commit();
      } finally { if (!committed.finished) await committed.rollback(); }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal((await m.SpeedboxPedido.findOne({ where: { envio_id: deferred.id } })).estado, 'pendiente');
      process.env.SPEEDBOX_ENABLED = 'true';
      await service.runCycle();
      assert.equal((await m.SpeedboxPedido.findOne({ where: { envio_id: deferred.id } })).estado, 'enviado');
      return { rollback_remote_calls: 0, rollback_outbox_rows: 0, recovery: 'enviado', old_created_at: true };
    } finally { process.env.SPEEDBOX_ENABLED = 'false'; }
  });
  await step('23 New confirmed order persists successfully despite immediate provider failure', async () => {
    process.env.SPEEDBOX_ENABLED = 'true';
    remote.failNext = true;
    try {
      const confirmed = await order();
      assert.equal(confirmed.estado, 'Confirmado');
      await expect.poll(async () => (await m.SpeedboxPedido.findOne({ where: { envio_id: confirmed.id } }))?.estado, { timeout: 10000 }).toBe('incierto');
      const saved = await m.Envio.findByPk(confirmed.id);
      assert.equal(saved.estado, 'Confirmado');
      assert.equal(saved.stock_descontado, true);
      return { creation_http_status: 201, estado: saved.estado, stock_reserved: true, speedbox: 'incierto' };
    } finally { process.env.SPEEDBOX_ENABLED = 'false'; }
  });
  // Replace only external file storage; multipart, file processing and payment state transitions stay real.
  const uploaded = [];
  require('../src/services/r2/r2.service').R2Service.uploadObject = async options => {
    uploaded.push({ key: options.key, contentType: options.contentType, bytes: options.body.length });
    return { url: `${api}/__fixtures/receipts/${encodeURIComponent(options.key)}` };
  };
  await adminRole.update({ nombre: 'administrador' });
  const adminContext = await resources.browser.newContext();
  const otherContext = await resources.browser.newContext();
  await request('post', 'auth/login', { email: admin.correo_electronico, password }, 200, adminContext.request);
  await request('post', 'auth/login', { email: other.correo_electronico, password }, 200, otherContext.request);
  const ownDepot = await m.Deposito.create({ usuario_id: user.id, nombre: 'Deposito propio E2E', ciudad: 'Asuncion', departamento: 'Central', direccion: 'Deposito 1', alcance: 'PROPIO' });
  const otherDepot = await m.Deposito.create({ usuario_id: other.id, nombre: 'Deposito ajeno E2E', ciudad: 'Asuncion', departamento: 'Central', direccion: 'Deposito 2', alcance: 'PROPIO' });
  const center = await m.Deposito.create({ usuario_id: admin.id, nombre: 'Centro Gesicomm E2E', ciudad: 'Asuncion', departamento: 'Central', direccion: 'Centro 1', alcance: 'GESICOMM' });
  const provider = await m.ProveedorLogistico.create({ nombre: 'Proveedor E2E', capacidades: [], activo: true });
  await m.CentroProveedorLogistico.create({ centro_id: center.id, proveedor_logistico_id: provider.id });
  await m.DeliveryZonaTarifa.create({ proveedor_logistico_id: provider.id, centro_id: center.id, ciudad: 'Asuncion', departamento: 'Central', costo: 12000 });
  const catalog = await m.Producto.create({ inquilino_id: inquilino.id, creado_por: admin.id, nombre: 'Catalogo variantes E2E', slug: 'catalogo-variantes-e2e', sku: 'CAT-001', precio_base: 50000, precio_costo: 30000, stock_salon: 0, stock_deposito: 20, cantidad_disponible: 20 });
  const red = await m.ProductoVariante.create({ inquilino_id: inquilino.id, producto_id: catalog.id, nombre: 'Rojo', sku_variante: 'CAT-ROJO', stock_salon: 0, stock_deposito: 10, stock: 10 });
  const blue = await m.ProductoVariante.create({ inquilino_id: inquilino.id, producto_id: catalog.id, nombre: 'Azul', sku_variante: 'CAT-AZUL', stock_salon: 0, stock_deposito: 10, stock: 10 });
  const procurement = require('../src/services/solicitudAbastecimiento.service');
  const base = 'solicitudes-abastecimiento';
  const createSupply = (extra = {}, requestContext = context.request) => request('post', base, { producto_id: catalog.id, variante_id: red.id, cantidad: 2, tipoLogistica: 'GESICOMM', ...extra }, 201, requestContext);
  const inventory = (owner, variant, depot) => m.InventarioUbicacion.findOne({ where: { usuario_id: owner, producto_id: catalog.id, variante_id: variant, deposito_id: depot } });
  async function receipt(id, requestContext = context.request) {
    const response = await requestContext.post(`${api}/api/${base}/${id}/comprobante`, { multipart: {
      comprobante: { name: 'comprobante-e2e.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nE2E fictional transfer receipt\n%%EOF') } } });
    assert.equal(response.status(), 200, await response.text());
  }
  async function advanceTo(id, target) {
    for (let i = 0; i < 10; i++) {
      const current = await m.SolicitudAbastecimiento.findByPk(id);
      if (current.estado === target) return;
      await request('post', `${base}/${id}/avanzar`, { centroGesicommId: center.id }, 200, adminContext.request);
    }
    throw new Error(`Solicitud ${id} did not reach ${target}`);
  }
  let ownSupply, centerSupply, financialSupply;
  await step('24 Procurement pending/rejected/validated payment cannot credit inventory early', async () => {
    await request('post', base, { producto_id: catalog.id, cantidad: 1, tipoLogistica: 'GESICOMM' }, 400);
    await request('post', base, { producto_id: catalog.id, variante_id: red.id, cantidad: 1.5, tipoLogistica: 'GESICOMM' }, 400);
    await request('post', base, { producto_id: catalog.id, variante_id: red.id, cantidad: 2, tipoLogistica: 'PROPIA', depositoId: otherDepot.id }, 400);
    ownSupply = await createSupply({ tipoLogistica: 'PROPIA', depositoId: ownDepot.id });
    assert.equal(ownSupply.costo_producto, 100000);
    assert.equal(ownSupply.costo_logistico, 12000);
    await request('post', `${base}/${ownSupply.id}/confirmar-recepcion`, {}, 400);
    await request('post', `${base}/${ownSupply.id}/avanzar`, {}, 400, adminContext.request);
    await receipt(ownSupply.id);
    await request('post', `${base}/${ownSupply.id}/validar-pago`, {}, 403);
    await request('post', `${base}/${ownSupply.id}/rechazar-pago`, { motivo: 'Comprobante ilegible E2E' }, 200, adminContext.request);
    assert.equal((await m.SolicitudAbastecimiento.findByPk(ownSupply.id)).estado, 'pago_rechazado');
    assert.equal(await inventory(user.id, red.id, ownDepot.id), null);
    await receipt(ownSupply.id);
    await request('post', `${base}/${ownSupply.id}/validar-pago`, {}, 200, adminContext.request);
    assert.equal(await inventory(user.id, red.id, ownDepot.id), null);
    await red.reload(); assert.equal(red.stock, 10);
    return { solicitud_id: ownSupply.id, states: ['pendiente_pago', 'pago_enviado', 'pago_rechazado', 'pago_enviado', 'pago_validado'], stock_before_physical_receipt: 10, uploaded_receipts: uploaded.length, costs: { goods: 100000, logistics: 12000 } };
  });
  await step('25 Own logistics: physical reception credits exact variant/depot/owner only once concurrently', async () => {
    await advanceTo(ownSupply.id, 'en_transito_a_deposito_cliente');
    await request('post', `${base}/${ownSupply.id}/confirmar-recepcion`, {}, 404, otherContext.request);
    const responses = await Promise.all([1, 2].map(() => context.request.post(`${api}/api/${base}/${ownSupply.id}/confirmar-recepcion`, { data: {} })));
    assert.deepEqual(responses.map(response => response.status()).sort(), [200, 400]);
    await red.reload(); await blue.reload(); await catalog.reload();
    assert.equal(red.stock, 12); assert.equal(blue.stock, 10); assert.equal(catalog.cantidad_disponible, 22);
    assert.equal((await inventory(user.id, red.id, ownDepot.id)).cantidad_disponible, 2);
    return { concurrent_statuses: [200, 400], red_stock: 12, blue_stock: 10, parent_stock: 22, location_stock: 2 };
  });
  await step('26 Gesicomm logistics: center receipt validates destination and isolates two owners', async () => {
    centerSupply = await createSupply({ variante_id: blue.id, cantidad: 3 });
    await receipt(centerSupply.id);
    await request('post', `${base}/${centerSupply.id}/validar-pago`, {}, 200, adminContext.request);
    await advanceTo(centerSupply.id, 'recibido_en_gesicomm');
    assert.equal(await inventory(user.id, blue.id, center.id), null);
    await request('post', `${base}/${centerSupply.id}/avanzar`, { centroGesicommId: ownDepot.id }, 400, adminContext.request);
    await request('post', `${base}/${centerSupply.id}/avanzar`, { centroGesicommId: center.id }, 200, adminContext.request);
    await request('post', `${base}/${centerSupply.id}/avanzar`, { centroGesicommId: center.id }, 400, adminContext.request);
    const otherSupply = await createSupply({ variante_id: blue.id, cantidad: 4 }, otherContext.request);
    await receipt(otherSupply.id, otherContext.request);
    await request('post', `${base}/${otherSupply.id}/validar-pago`, {}, 200, adminContext.request);
    await advanceTo(otherSupply.id, 'disponible_en_gesicomm');
    assert.equal((await inventory(user.id, blue.id, center.id)).cantidad_disponible, 3);
    assert.equal((await inventory(other.id, blue.id, center.id)).cantidad_disponible, 4);
    await catalog.reload(); assert.equal(catalog.cantidad_disponible, 22);
    return { user_units: 3, other_units: 4, shared_center: center.id, catalog_not_inflated: 22 };
  });
  await step('27 Concurrent independent receipts do not lose stock; NULL-variant uniqueness is enforced', async () => {
    const helper = require('../src/services/inventarioUbicacion.service');
    await Promise.all([1, 2].map(() => m.sequelize.transaction(t => helper.acreditar({ usuario_id: user.id,
      producto_id: product.id, deposito_id: center.id, cantidad: 1, alcance: 'GESICOMM' }, t))));
    const where = { usuario_id: user.id, producto_id: product.id, variante_id: null, deposito_id: center.id };
    assert.equal(await m.InventarioUbicacion.count({ where }), 1);
    assert.equal((await m.InventarioUbicacion.findOne({ where })).cantidad_disponible, 2);
    await assert.rejects(m.InventarioUbicacion.create(where), /Validation error/);
    return { rows: 1, available: 2, duplicate_row_rejected: true };
  });
  await step('28 Mixed deposits roll back all reservations and never send a remote order', async () => {
    const redBefore = red.stock;
    const blueBefore = blue.stock;
    const beforeRemote = remote.orders.length;
    await request('post', 'envios', { cliente: 'Sin variante E2E', monto: 50000, items: [{ producto_id: catalog.id, cantidad: 1, precio_unitario: 50000 }] }, 400);
    const response = await context.request.post(`${api}/api/envios`, { data: { nombre_cliente: 'Mezclado', apellido_cliente: 'E2E', telefono: '0981000000', ciudad: 'Asuncion', departamento: 'Central', direccion: 'Direccion E2E', courier_id: courier.id, metodo_pago_id: payment.id, monto: 100000,
      items: [{ producto_id: catalog.id, variante_id: red.id, cantidad: 1, precio_unitario: 50000 }, { producto_id: catalog.id, variante_id: blue.id, cantidad: 1, precio_unitario: 50000 }] } });
    assert.equal(response.status(), 409, await response.text());
    await red.reload(); await blue.reload();
    assert.equal(red.stock, redBefore); assert.equal(blue.stock, blueBefore); assert.equal(remote.orders.length, beforeRemote);
    assert.equal((await inventory(user.id, red.id, ownDepot.id)).cantidad_disponible, 2);
    assert.equal((await inventory(user.id, blue.id, center.id)).cantidad_disponible, 3);
    return { http_status: 409, variant_stock_unchanged: true, location_stock_unchanged: true, remote_orders: 0 };
  });
  await step('29 Gesicomm variant order reserves only its owner; returned goods require complete inspection', async () => {
    await m.Tienda.update({ modalidad_fulfillment: 'GESICOMM' }, { where: { usuario_id: user.id } });
    const returned = await order({ monto: 100000, items: [{ producto_id: catalog.id, variante_id: blue.id, nombre_producto: 'Azul', cantidad: 2, precio_unitario: 50000 }] });
    assert.equal((await m.Envio.findByPk(returned.id)).abastecimiento_estado, 'no_requiere');
    const mapping = await request('post', `integraciones/speedbox/pedidos/${returned.id}/enviar`);
    assert.equal(remote.orders.at(-1).payload.items[0].sku, 'CAT-AZUL');
    assert.equal((await inventory(user.id, blue.id, center.id)).cantidad_disponible, 1);
    assert.equal((await inventory(other.id, blue.id, center.id)).cantidad_disponible, 4);
    await webhook(event(mapping.order_id, 'devuelto', 'evt-variant-return', 20000));
    await blue.reload(); assert.equal(blue.stock, 8);
    const item = await m.EnvioItem.findOne({ where: { envio_id: returned.id } });
    const component = await m.EnvioItemComponente.findOne({ where: { envio_item_id: item.id } });
    const inspect = (cantidad, condicion, marcar_estado) => ({ items: [{ envio_item_componente_id: component.id, cantidad, condicion }], marcar_estado });
    await request('post', `envios/${returned.id}/devolucion`, inspect(1, 'vendible', true), 400);
    await blue.reload(); assert.equal(blue.stock, 8);
    await request('post', `envios/${returned.id}/devolucion`, inspect(1, 'vendible', false));
    await request('post', `envios/${returned.id}/devolucion`, inspect(1, 'dañado', true));
    await blue.reload(); assert.equal(blue.stock, 9);
    assert.equal((await inventory(user.id, blue.id, center.id)).cantidad_disponible, 2);
    assert.equal((await inventory(other.id, blue.id, center.id)).cantidad_disponible, 4);
    assert.equal((await m.SpeedboxEvento.findOne({ where: { event_key: 'id:evt-variant-return' } })).estado, 'procesado');
    await request('post', `envios/${returned.id}/devolucion`, inspect(1, 'vendible', true), 400);
    await m.Tienda.update({ modalidad_fulfillment: 'PROPIA' }, { where: { usuario_id: user.id } });
    return { sku: 'CAT-AZUL', available_after_inspection: 9, vendible: 1, damaged: 1, own_location_units: 2, other_owner_unchanged: 4, review_closed: true };
  });
  await step('30 Browser wallet reconciliation is explicit, durable and does not settle customer/provider payments', async () => {
    financialSupply = await createSupply({ variante_id: blue.id, cantidad: 1 });
    const movement = { event: 'wallet.transaction', event_id: 'evt-wallet-provider', occurred_at: new Date().toISOString(), data: { tienda_id: 54, amount: 100000, direction: 'debit', currency: 'PYG' } };
    await webhook(movement);
    const row = await m.SpeedboxEvento.findOne({ where: { event_key: 'id:evt-wallet-provider' } });
    await page.getByRole('button', { name: 'Actualizar panel', exact: true }).click();
    await page.getByRole('button', { name: `Conciliar movimiento ${row.id}` }).click();
    const modal = page.getByRole('dialog', { name: `Conciliar movimiento ${row.id}` });
    await modal.getByLabel('Concepto').selectOption('pago_proveedor');
    await modal.getByLabel('Referencia').selectOption(`solicitud:${financialSupply.id}`);
    await modal.getByLabel('Nota de conciliacion').fill('Pago cotejado con comprobante SOL E2E');
    await page.screenshot({ path: path.join(artifacts, 'reconciliation-desktop.png') });
    await modal.getByRole('button', { name: 'Conciliar', exact: true }).click();
    await expect(page.getByText('Movimiento conciliado.', { exact: true })).toBeVisible();
    await row.reload(); assert.equal(row.conciliacion.concepto, 'pago_proveedor');
    assert.equal(row.conciliacion.solicitud_id, financialSupply.id);
    const result = await request('post', `integraciones/speedbox/eventos/${row.id}/conciliar`, { concepto: 'pago_proveedor', solicitud_id: financialSupply.id, envio_id: null, nota: 'Pago cotejado con comprobante SOL E2E' });
    assert.equal(result.duplicate, true);
    await webhook(movement); await row.reload(); assert.equal(row.conciliacion.solicitud_id, financialSupply.id);
    const state = await request('get', 'integraciones/speedbox');
    assert.equal(state.orders.find(order => order.envio_id === first.id).finanzas.estado_financiero, 'pendiente_liquidacion');
    assert.equal((await m.SolicitudAbastecimiento.findByPk(financialSupply.id)).estado, 'pendiente_pago');
    return { wallet_event: row.id, manual_reference: financialSupply.id, replay_idempotent: true, no_automatic_liquidation: true, procurement_payment_unchanged: 'pendiente_pago' };
  });
  await step('31 Reconciliation rejects wrong owner, direction, reference, missing ID and changed classification', async () => {
    const row = await m.SpeedboxEvento.findOne({ where: { event_key: 'id:evt-wallet-provider' } });
    const payload = { concepto: 'pago_proveedor', envio_id: null, solicitud_id: financialSupply.id, nota: 'Pago cotejado con comprobante SOL E2E' };
    await request('post', `integraciones/speedbox/eventos/${row.id}/conciliar`, payload, 404, otherContext.request);
    await request('post', `integraciones/speedbox/eventos/${row.id}/conciliar`, { ...payload, nota: 'Cambio sin auditoria' }, 409);
    const debit = await m.SpeedboxEvento.findOne({ where: { event_key: 'id:evt-wallet-replay' } });
    await request('post', `integraciones/speedbox/eventos/${debit.id}/conciliar`, { ...payload, concepto: 'cobro_cliente', envio_id: first.id, solicitud_id: null }, 400);
    await request('post', `integraciones/speedbox/eventos/${debit.id}/conciliar`, { ...payload, concepto: 'envio', envio_id: first.id, solicitud_id: ownSupply.id }, 400);
    await request('post', `integraciones/speedbox/eventos/${debit.id}/conciliar`, { ...payload, solicitud_id: 999999 }, 404);
    const observation = await m.SpeedboxEvento.findOne({ where: { tipo: 'wallet.transaction', estado: 'revision' } });
    await request('post', `integraciones/speedbox/eventos/${observation.id}/conciliar`, { concepto: 'otro', envio_id: null, solicitud_id: null, nota: 'Sin ID verificable' }, 409);
    return { owner: 404, changed_classification: 409, invalid_direction: 400, two_references: 400, unknown_reference: 404, missing_remote_id: 409 };
  });
  await step('32 Same-origin mixed lines deliver without procuring twice or crediting physical stock', async () => {
    const recipeCost = await m.sequelize.transaction(t => require('../src/controllers/envioController').calcularAbastecimientoDesdeItems([
      { producto_id: catalog.id, variante_id: red.id, cantidad: 2 },
      { producto_id: catalog.id, variante_id: red.id, cantidad: 2 }], user.id, t));
    assert.equal(recipeCost.costo, 100000);
    await m.Tienda.update({ modalidad_fulfillment: 'GESICOMM' }, { where: { usuario_id: user.id } });
    const mixed = await order({ monto: 100000, items: [1, 2].map(() => ({ producto_id: catalog.id, variante_id: blue.id, cantidad: 1, precio_unitario: 50000 })) });
    assert.equal((await m.Envio.findByPk(mixed.id)).abastecimiento_costo, 0);
    const mapping = await request('post', `integraciones/speedbox/pedidos/${mixed.id}/enviar`);
    assert.equal(remote.orders.at(-1).payload.items.length, 2);
    assert(remote.orders.at(-1).payload.items.every(item => item.sku === 'CAT-AZUL'));
    assert.equal((await inventory(user.id, blue.id, center.id)).cantidad_reservada, 2);
    await webhook(event(mapping.order_id, 'entregado', 'evt-mixed-delivered', 25000));
    await webhook(event(mapping.order_id, 'entregado', 'evt-mixed-delivered', 25000));
    const location = await inventory(user.id, blue.id, center.id);
    assert.equal(location.cantidad_disponible, 0); assert.equal(location.cantidad_reservada, 0);
    assert.equal((await inventory(other.id, blue.id, center.id)).cantidad_disponible, 4);
    assert.equal((await m.SolicitudAbastecimiento.findByPk(financialSupply.id)).estado, 'pendiente_pago');
    await m.Tienda.update({ modalidad_fulfillment: 'PROPIA' }, { where: { usuario_id: user.id } });
    return { stock_credited_by_delivery: 0, new_procurement_cost: 0, other_owner_units: 4, remote_lines: 2,
      repeated_recipe_quantity: 4, already_owned: 2, incremental_purchase_cost: recipeCost.costo };
  });
  await step('33 Inbound physical reception counts differences and enables only accepted units once', async () => {
    const ingresso = await request('post', 'inventario/ingresos', { centro_gesicomm_id: center.id, items: [
      { producto_id: catalog.id, variante_id: red.id, cantidad_declarada: 3 },
      { producto_id: catalog.id, variante_id: blue.id, cantidad_declarada: 2 }] }, 201);
    const prefix = `inventario/ingresos/${ingresso.id}`;
    const before = (await inventory(user.id, blue.id, center.id)).cantidad_disponible;
    await request('post', `${prefix}/habilitar-stock`, {}, 400, adminContext.request);
    await request('post', `${prefix}/confirmar-envio`, {});
    await request('post', `${prefix}/marcar-en-transito`, {}, 404, otherContext.request);
    await request('post', `${prefix}/marcar-en-transito`, { transportista: 'Transporte E2E' });
    await request('post', `${prefix}/recepcion`, {}, 403);
    await request('post', `${prefix}/recepcion`, {}, 200, adminContext.request);
    const redItem = ingresso.items.find(item => item.variante_id === red.id);
    const blueItem = ingresso.items.find(item => item.variante_id === blue.id);
    await request('post', `${prefix}/resolver-diferencias`, { conteos: [{ item_id: redItem.id, cantidad_recibida: 1, cantidad_aceptada: 2 }] }, 400, adminContext.request);
    await request('post', `${prefix}/resolver-diferencias`, { conteos: [{ item_id: redItem.id, cantidad_recibida: 2, cantidad_aceptada: 2 }] }, 200, adminContext.request);
    await request('post', `${prefix}/habilitar-stock`, {}, 400, adminContext.request);
    assert.equal((await inventory(user.id, blue.id, center.id)).cantidad_disponible, before);
    await request('post', `${prefix}/resolver-diferencias`, { conteos: [{ item_id: blueItem.id, cantidad_recibida: 1, cantidad_aceptada: 1 }] }, 200, adminContext.request);
    await request('post', `${prefix}/habilitar-stock`, {}, 200, adminContext.request);
    await request('post', `${prefix}/habilitar-stock`, {}, 200, adminContext.request);
    assert.equal((await inventory(user.id, red.id, center.id)).cantidad_disponible, 2);
    assert.equal((await inventory(user.id, blue.id, center.id)).cantidad_disponible, before + 1);
    return { ingreso_id: ingresso.id, declared: 5, received_and_accepted: 3, duplicate_enable: 'idempotent', incomplete_count_rejected: true };
  });
  await step('34 Migration blocks historical duplicates without merging or changing quantities', async () => {
    const qi = m.sequelize.getQueryInterface();
    const migration = require('../migrations/20261002200000-speedbox-abastecimiento');
    await m.sequelize.query('DROP INDEX idx_inventario_propietario_simple');
    const where = { usuario_id: user.id, producto_id: product.id, variante_id: null, deposito_id: center.id };
    const duplicate = await m.InventarioUbicacion.create({ ...where, cantidad_disponible: 7 });
    await assert.rejects(migration.up(qi, require('sequelize')), /Inventario duplicado/);
    assert.deepEqual((await m.InventarioUbicacion.findAll({ where, order: [['id', 'ASC']] })).map(row => row.cantidad_disponible), [2, 7]);
    // Remove only the deliberately injected test fixture, then restore the index.
    await duplicate.destroy();
    await migration.up(qi, require('sequelize'));
    assert.equal((await m.InventarioUbicacion.findOne({ where })).cantidad_disponible, 2);
    return { duplicate_quantities_untouched: [2, 7], migration_rejected: true, corrected_fixture_index_restored: true };
  });
  await step('35 Sale-linked procurement completes both logistics without crediting already reserved stock again', async () => {
    const goods = await m.Producto.create({ inquilino_id: inquilino.id, creado_por: admin.id, nombre: 'Abastecimiento por venta E2E', slug: 'abasto-venta-e2e', sku: 'SUPPLY-SALE', precio_base: 50000, stock_deposito: 10, stock_salon: 0, cantidad_disponible: 10 });
    const results = [];
    for (const type of ['PROPIA', 'GESICOMM']) {
      process.env.SPEEDBOX_ENABLED = 'true';
      const sale = await order({ monto: 50000, costo_envio: 7000, costo_fulfillment: 1000,
        items: [{ producto_id: goods.id, cantidad: 1, precio_unitario: 50000 }] });
      await expect.poll(async () => (await m.SpeedboxPedido.findOne({ where: { envio_id: sale.id } }))?.estado).toBe('enviado');
      process.env.SPEEDBOX_ENABLED = 'false';
      const mapping = await m.SpeedboxPedido.findOne({ where: { envio_id: sale.id } });
      const prefix = `envios/${sale.id}/abastecimiento`;
      assert.equal(sale.abastecimiento_estado, 'pendiente_pago');
      await request('put', `${prefix}/logistica`, { tipoLogistica: type, ...(type === 'PROPIA' ? { depositoId: ownDepot.id } : {}) });
      await request('post', `${prefix}/confirmar-recepcion`, {}, 400);
      const proof = async () => {
        const response = await context.request.post(`${api}/api/${prefix}/comprobante`, { multipart: { comprobante: {
          name: 'pago-venta.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nFictional sale procurement receipt\n%%EOF') } } });
        assert.equal(response.status(), 200, await response.text());
      };
      await proof();
      if (type === 'PROPIA') {
        await request('post', `${prefix}/pago/rechazar`, { motivo: 'Revisar comprobante E2E' }, 200, adminContext.request);
        await proof();
      }
      await request('post', `${prefix}/pago/validar`, {}, 200, adminContext.request);
      const target = type === 'PROPIA' ? 'en_transito_a_deposito_cliente' : 'disponible_en_gesicomm';
      for (let i = 0; i < 10; i++) {
        if ((await m.Envio.findByPk(sale.id)).abastecimiento_estado === target) break;
        await request('post', `${prefix}/avanzar`, {}, 200, adminContext.request);
      }
      await goods.reload(); const available = goods.cantidad_disponible;
      if (type === 'PROPIA') {
        await request('post', `${prefix}/confirmar-recepcion`, {}, 404, otherContext.request);
        await request('post', `${prefix}/confirmar-recepcion`, {});
        await request('post', `${prefix}/confirmar-recepcion`, {}, 400);
      }
      await goods.reload(); assert.equal(goods.cantidad_disponible, available);
      assert.equal(await m.InventarioUbicacion.count({ where: { producto_id: goods.id } }), 0);
      const saved = await m.Envio.findByPk(sale.id);
      assert.equal(saved.abastecimiento_estado, type === 'PROPIA' ? 'recibido_en_deposito_cliente' : 'disponible_en_gesicomm');
      assert(saved.abastecimiento_pagado_at);
      assert.equal(saved.estado_financiero, 'pendiente_liquidacion');
      assert.equal(remote.calls.filter(call => call.action === 'order' && call.body.external_order_id === mapping.external_order_id).length, 1);
      await webhook(event(mapping.order_id, 'entregado', `evt-sale-procurement-${type}`, 30000));
      await goods.reload(); assert.equal(goods.cantidad_disponible, available);
      results.push({ logistics: type, final_procurement: saved.abastecimiento_estado, available_stock: available,
        procurement_cost: saved.abastecimiento_costo, last_mile: saved.costo_envio, fulfillment: saved.costo_fulfillment, remote_order_calls: 1 });
    }
    return { routes: results, receipt_stock_credit: 0, duplicate_receipt_rejected: true, provider_payment_separate_from_customer_liquidation: true };
  });
  await adminContext.close(); await otherContext.close();
  await step('36 Desktop/mobile evidence, persistent UI state and no uncaught browser errors', async () => {
    await page.getByRole('button', { name: 'Actualizar panel', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Importes por pedido' })).toBeVisible();
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const name = viewport.width === 1440 ? 'desktop' : 'mobile';
      await page.setViewportSize(viewport);
      await page.reload();
      await expect(page.getByLabel('Courier Speedbox')).toHaveValue(String(courier.id));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      assert(await page.locator('.dashboard-main').evaluate(el => el.scrollWidth <= el.clientWidth));
      await page.evaluate(() => Promise.all(document.getAnimations()
        .filter(animation => Number.isFinite(animation.effect?.getTiming().iterations))
        .map(animation => animation.finished.catch(() => {}))));
      await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: true });
      await page.getByRole('heading', { name: 'Pedidos enviados', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(artifacts, `${name}-orders.png`) });
      await page.getByRole('heading', { name: 'Movimientos de billetera', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(artifacts, `${name}-wallet.png`) });
    }
    assert.deepEqual(pageErrors, []);
    report.final_stock = await stock();
    report.remote_calls = remote.calls;
    report.orders = await m.SpeedboxPedido.findAll({ attributes: ['envio_id', 'order_id', 'external_order_id', 'estado', 'status', 'intentos'], raw: true });
    report.events = await m.SpeedboxEvento.findAll({ attributes: ['event_key', 'tipo', 'estado', 'detalle', 'source'], raw: true });
    report.inventory_locations = await m.InventarioUbicacion.findAll({ raw: true, order: [['id', 'ASC']] });
    report.procurements = await m.SolicitudAbastecimiento.findAll({ attributes: ['id', 'usuario_id', 'producto_id', 'variante_id', 'cantidad', 'tipo_logistica', 'estado', 'costo_producto', 'costo_logistico'], raw: true });
    report.reconciliations = await m.SpeedboxEvento.findAll({ where: { conciliacion: { [require('sequelize').Op.ne]: null } }, attributes: ['event_key', 'conciliacion'], raw: true });
    return { screenshots: ['desktop.png', 'desktop-orders.png', 'desktop-wallet.png', 'mobile.png', 'mobile-orders.png', 'mobile-wallet.png', 'retry-desktop.png'], browser_errors: pageErrors };
  });
}

(async () => {
  try {
    await main(); report.status = 'passed';
    if (previewMode) {
      await resources.browser.close(); resources.browser = null;
      // Interactive preview stays entirely fictional; no invented signup URL.
      process.env.SPEEDBOX_ENABLED = 'true';
      delete process.env.SPEEDBOX_REGISTRATION_URL;
      report.preview = { ...resources.preview, running: true };
      fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
      console.log(`PREVIEW ${resources.preview.url}`);
      console.log(`DEMO LOGIN ${resources.preview.email} / ${resources.preview.password}`);
      console.log(`STOP: POST ${resources.preview.api}/__e2e/stop (or Ctrl+C)`);
      await new Promise(resolve => {
        resources.app.post('/__e2e/stop', (req, res) => { res.on('finish', resolve); res.json({ ok: true }); });
        process.once('SIGINT', resolve);
        process.once('SIGTERM', resolve);
      });
      report.preview.running = false;
    }
  }
  catch (error) {
    report.status = 'failed'; report.error = error.stack; console.error(error); process.exitCode = 1;
    if (resources.page) {
      await resources.page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
      report.failure_url = resources.page.url();
      report.failure_text = await resources.page.locator('body').innerText().catch(() => '');
    }
  }
  finally {
    const errors = [];
    for (const [name, close] of [
      ['browser', () => resources.browser?.close()],
      ['vite', async () => {
        if (resources.vite && resources.vite.exitCode === null) {
          const exited = new Promise(resolve => resources.vite.once('exit', resolve));
          resources.vite.kill();
          await exited;
        }
        resources.viteLog?.end();
      }],
      ['http', () => Promise.all(resources.servers.map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })))],
      ['sequelize', () => resources.sequelize?.close()],
      ['postgres', () => { if (resources.pgStarted) pg('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop']); }],
    ]) {
      try { await close(); } catch (error) { errors.push({ resource: name, error: error.message }); }
    }
    global.fetch = nativeFetch;
    report.cleanup_errors = errors;
    if (errors.length) { report.status = 'failed'; process.exitCode = 1; }
    report.finished_at = new Date().toISOString();
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`REPORT ${path.join(artifacts, 'report.json')}`);
  }
})();
