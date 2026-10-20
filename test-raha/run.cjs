'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');

const backend = path.resolve(__dirname, '..');
const frontend = path.resolve(backend, '../gesicomm-frontend');
const artifacts = path.resolve(backend, `../outputs/raha-e2e-${Date.now()}`);
const dataDir = path.join(artifacts, 'postgres');
const pgBin = process.env.RAHA_E2E_PG_BIN || 'C:\\Program Files\\PostgreSQL\\17\\bin';
const resources = { servers: [] };
const report = { started_at: new Date().toISOString(), scope: 'Real browser, Express routes, authentication, services and disposable PostgreSQL. No business API mocks; no external RAHA calls.', steps: [] };
const nativeFetch = global.fetch;

function pg(command, args) {
  const output = fs.openSync(path.join(artifacts, 'postgres-commands.log'), 'a');
  try {
    execFileSync(path.join(pgBin, `${command}${process.platform === 'win32' ? '.exe' : ''}`), args,
      { windowsHide: true, stdio: ['ignore', output, output], timeout: 60000 });
  } finally { fs.closeSync(output); }
}
async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const result = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return result;
}
async function step(name, action) {
  const start = Date.now();
  try {
    const evidence = await action();
    report.steps.push({ name, status: 'passed', milliseconds: Date.now() - start, evidence });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.steps.push({ name, status: 'failed', error: error.stack });
    throw error;
  }
}
async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  console.log(`Artifacts: ${artifacts}`);
  const dbPort = await port();
  const dbName = `raha_e2e_${crypto.randomBytes(4).toString('hex')}`;
  await step('01 Isolated PostgreSQL cluster', async () => {
    pg('initdb', ['-D', dataDir, '-U', 'raha_e2e', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
    pg('pg_ctl', ['-D', dataDir, '-l', path.join(artifacts, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${dbPort} -F`, '-w', 'start']);
    resources.postgres = true;
    pg('createdb', ['-h', '127.0.0.1', '-p', String(dbPort), '-U', 'raha_e2e', dbName]);
    return { database: dbName, port: dbPort };
  });
  Object.assign(process.env, { NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: String(dbPort), DB_NAME: dbName,
    DB_USER: 'raha_e2e', DB_PASSWORD: '', JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    REFRESH_TOKEN_SECRET: crypto.randomBytes(32).toString('hex'), RAHA_PORTAL_JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'), SPEEDBOX_ENABLED: 'false', SPEEDBOX_ENVIRONMENT: 'sandbox',
    SMTP_USER: '', SMTP_PASS: '', BREVO_API_KEY: '', BREVO_ADMIN_EMAIL: '', BREVO_FROM_EMAIL: '',
    RAHA_PRIVATE_BUCKET: '', RAHA_PRIVATE_STORAGE_PATH: path.join(artifacts, 'private-raha') });
  global.fetch = (input, options) => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(String(input)).hostname)) throw new Error('External network forbidden in RAHA E2E');
    return nativeFetch(input, options);
  };
  const models = require('../src/models');
  resources.sequelize = models.sequelize;
  models.sequelize.options.logging = false;
  await step('02 Real schema and both operational migrations', async () => {
    const comments = [];
    for (const model of Object.values(models.sequelize.models)) {
      for (const attribute of Object.values(model.rawAttributes)) {
        if (attribute.comment) { comments.push([attribute, attribute.comment]); delete attribute.comment; }
      }
      model.refreshAttributes();
    }
    try { await models.sequelize.sync(); }
    finally {
      for (const [attribute, comment] of comments) attribute.comment = comment;
      for (const model of Object.values(models.sequelize.models)) model.refreshAttributes();
    }
    const qi = models.sequelize.getQueryInterface();
    await require('../migrations/20261019140000-raha-operaciones').down(qi);
    await require('../migrations/20261019140000-raha-operaciones').up(qi);
    await require('../migrations/20261019140000-raha-operaciones').up(qi);
    await require('../migrations/20261019160000-raha-envios-estados-logisticos').up(qi);
    await require('../migrations/20261019160000-raha-envios-estados-logisticos').up(qi);
    return { logistics_migration_rerunnable: true };
  });
  const tenant = await models.Inquilino.create({ nombre: 'RAHA E2E' });
  const foreignTenant = await models.Inquilino.create({ nombre: 'Tenant ajeno E2E' });
  const role = await models.Rol.create({ nombre: 'usuario' });
  const adminRole = await models.Rol.create({ nombre: 'administrador' });
  await role.addPermiso(await models.Permiso.create({ nombre: 'gestionar_tienda' }));
  const password = `E2E-${crypto.randomBytes(16).toString('hex')}!`;
  const hash = await require('bcryptjs').hash(password, 4);
  const user = await models.Usuario.create({ nombre: 'Comercio E2E', correo_electronico: 'comercio@raha-e2e.test',
    contrasena_hash: hash, email_verificado: true, inquilino_id: tenant.id, rol_id: role.id });
  const other = await models.Usuario.create({ nombre: 'Otro comercio E2E', correo_electronico: 'otro@raha-e2e.test',
    contrasena_hash: hash, email_verificado: true, inquilino_id: tenant.id, rol_id: role.id });
  const admin = await models.Usuario.create({ nombre: 'Catálogo E2E', correo_electronico: 'catalogo@raha-e2e.test',
    contrasena_hash: hash, email_verificado: true, inquilino_id: tenant.id, rol_id: adminRole.id });
  const store = await models.Tienda.create({ usuario_id: user.id, inquilino_id: tenant.id, nombre: 'Tienda RAHA E2E', subdominio: 'raha-e2e' });
  const otherStore = await models.Tienda.create({ usuario_id: other.id, inquilino_id: tenant.id, nombre: 'Otra tienda E2E', subdominio: 'otra-raha-e2e' });
  const plan = await models.Plan.create({ codigo: 'raha-e2e', nombre: 'Plan E2E', precio: 10000, features: ['tienda'] });
  for (const merchant of [user, other]) await models.Suscripcion.create({ usuario_id: merchant.id, plan_id: plan.id,
    email: merchant.correo_electronico, estado: 'activa', precio_pagado: 10000, periodo_inicio: new Date(), periodo_fin: new Date(Date.now() + 86400000 * 30) });
  const origin = await models.Deposito.create({ usuario_id: user.id, tienda_id: store.id, nombre: 'Depósito Central E2E', ciudad: 'Luque', direccion: 'Calle Central 100' });
  const foreignOrigin = await models.Deposito.create({ usuario_id: other.id, tienda_id: otherStore.id, nombre: 'Depósito ajeno E2E', ciudad: 'Luque', direccion: 'Calle 200' });
  const productData = { inquilino_id: tenant.id, creado_por: user.id, tienda_id: store.id, precio_base: 50000, precio_costo: 20000, activo: true };
  const tracked = await models.Producto.create({ ...productData, nombre: 'Termo registrado E2E', slug: 'termo-e2e', sku: 'TRM-E2E' });
  const declared = await models.Producto.create({ ...productData, nombre: 'Producto sin ubicación E2E', slug: 'sin-ubicacion-e2e', sku: 'DECL-E2E' });
  const variantProduct = await models.Producto.create({ ...productData, nombre: 'Remera E2E', slug: 'remera-e2e', sku: 'REM-E2E' });
  const variant = await models.ProductoVariante.create({ producto_id: variantProduct.id, inquilino_id: tenant.id, nombre: 'Azul', sku_variante: 'REM-AZUL' });
  await models.ProductoVariante.create({ producto_id: variantProduct.id, inquilino_id: tenant.id, nombre: 'Inactiva', activo: false });
  for (const product of [tracked, declared, variantProduct]) await models.ProductoImagen.create({ producto_id: product.id,
    inquilino_id: tenant.id, url: '/uploads/raha-e2e.svg', es_principal: true });
  await models.ProductoImagen.create({ producto_id: variantProduct.id, variante_id: variant.id,
    inquilino_id: tenant.id, url: '/uploads/raha-e2e-variante.svg' });
  const inventory = await models.InventarioUbicacion.create({ usuario_id: user.id, deposito_id: origin.id, producto_id: tracked.id, cantidad_disponible: 7 });
  const foreignProduct = await models.Producto.create({ ...productData, creado_por: other.id, tienda_id: otherStore.id, nombre: 'Privado ajeno E2E', slug: 'privado-ajeno' });
  await models.Producto.create({ ...productData, inquilino_id: foreignTenant.id, creado_por: null, tienda_id: null, nombre: 'Otro tenant E2E', slug: 'otro-tenant-e2e' });
  for (let index = 0; index < 12; index++) await models.Producto.create({ ...productData, creado_por: admin.id, tienda_id: null, nombre: `Catálogo público E2E ${index}`, slug: `catalogo-e2e-${index}` });
  await models.RahaSolicitud.create({ usuario_id: user.id, tienda_id: store.id, inquilino_id: tenant.id, estado: 'aprobada' });
  const supply = await models.SolicitudAbastecimiento.create({ usuario_id: user.id, producto_id: tracked.id, cantidad: 2,
    tipo_logistica: 'PROPIA', deposito_destino_id: origin.id, costo_producto: 100000, costo_logistico: 20000, estado: 'solicitado_raha' });
  await models.SpeedboxPedido.create({ usuario_id: user.id, solicitud_abastecimiento_id: supply.id, environment: 'sandbox',
    external_order_id: 'abastecimiento-e2e', order_id: '9000000000216185', estado: 'enviado', status: 'en_camino',
    status_at: new Date(), request_payload: { private_marker: 'must-not-be-exposed' } });
  for (const owner of [user, other]) await models.SpeedboxEvento.create({ usuario_id: owner.id, environment: 'sandbox',
    event_key: `supply-e2e-${owner.id}`, tipo: 'shipment.status_changed', order_id: '9000000000216185',
    occurred_at: new Date(), source: 'webhook', payload: { data: { status: owner.id === user.id ? 'en_camino' : 'extraviado' } }, estado: 'procesado' });
  const operator = await models.RahaPortalUsuario.create({ nombre: 'Recepción E2E', email: 'operador@raha-e2e.test', password_hash: hash });
  const express = require('express');
  const app = express();
  app.use(require('cors')({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.get(['/uploads/raha-e2e.svg', '/uploads/raha-e2e-variante.svg'], (req, res) => res.type('svg').send('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#edf3f7"/><rect x="32" y="12" width="36" height="76" rx="10" fill="#ff5947"/></svg>'));
  for (const [mount, route] of [['auth', 'auth'], ['mi-tienda', 'tienda'], ['tiendas', 'tiendas'], ['depositos', 'depositoRoutes'],
    ['inventario', 'inventarioRoutes'], ['solicitudes-abastecimiento', 'solicitudAbastecimientoRoutes'], ['integraciones/raha', 'raha'],
    ['raha-portal', 'rahaPortal'], ['educacion', 'educacionRoutes']]) app.use(`/api/${mount}`, require(`../src/routes/${route}`));
  app.use('/api', require('../src/routes/suscripciones'));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  const server = http.createServer(app);
  resources.servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  const vitePort = await port();
  const preview = `http://127.0.0.1:${vitePort}`;
  const viteOutput = fs.openSync(path.join(artifacts, 'vite.log'), 'a');
  resources.vite = spawn(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
    { cwd: frontend, windowsHide: true, env: { ...process.env, VITE_API_URL: api }, stdio: ['ignore', viteOutput, viteOutput] });
  fs.closeSync(viteOutput);
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (resources.vite.exitCode != null) throw new Error('Vite exited; inspect vite.log');
    try { if ((await nativeFetch(preview)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, 'Vite startup timed out');
  const { chromium, expect } = require(require.resolve('@playwright/test', { paths: [frontend] }));
  resources.browser = await chromium.launch({ headless: true });
  const merchant = await resources.browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const portal = await resources.browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const foreign = await resources.browser.newContext();
  const merchantPage = await merchant.newPage();
  const portalPage = await portal.newPage();
  resources.pages = [merchantPage, portalPage];
  const pageErrors = [];
  for (const page of [merchantPage, portalPage]) {
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  }
  async function request(context, method, endpoint, data, expected = 200, token) {
    const response = await context.request[method](`${api}/${endpoint}`, { data, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const body = await response.json();
    assert.equal(response.status(), expected, `${method} ${endpoint}: ${JSON.stringify(body)}`);
    return body;
  }
  const merchantRequest = (method, endpoint, data, expected) => request(merchant, method, `integraciones/raha/operaciones/${endpoint}`, data, expected);
  let token;
  const portalRequest = (method, endpoint, data, expected) => request(portal, method, `raha-portal/operaciones/${endpoint}`, data, expected, token);
  let destination;
  let shipment;
  await step('03 Real merchant authentication and RAHA browser login', async () => {
    await request(merchant, 'post', 'auth/login', { email: user.correo_electronico, password });
    await request(foreign, 'post', 'auth/login', { email: other.correo_electronico, password });
    assert((await merchant.cookies()).some(cookie => cookie.name === 'accessToken' && cookie.httpOnly));
    await portalPage.goto(`${preview}/raha/login`);
    await portalPage.getByLabel('Email institucional').fill(operator.email);
    await portalPage.getByLabel('Contraseña', { exact: true }).fill(password);
    await portalPage.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await expect(portalPage).toHaveURL(/raha\/solicitudes/);
    token = await portalPage.evaluate(() => localStorage.getItem('gesicomm:rahaPortalToken'));
    assert(token);
  });
  await step('04 RAHA publishes reception depot through browser and real API', async () => {
    await portalPage.getByRole('button', { name: 'Depósitos RAHA', exact: true }).click();
    await portalPage.getByRole('button', { name: 'Agregar depósito RAHA' }).click();
    await portalPage.getByLabel('Nombre', { exact: true }).fill('Recepción RAHA E2E');
    await portalPage.getByLabel('Ciudad', { exact: true }).fill('Asunción');
    await portalPage.getByLabel('Dirección de recepción').fill('Avenida España 123');
    await portalPage.getByRole('button', { name: 'Guardar depósito', exact: true }).click();
    await expect(portalPage.getByRole('status').filter({ hasText: 'Depósito RAHA guardado' })).toBeVisible();
    [destination] = await merchantRequest('get', 'destinos');
    assert.equal(destination.nombre, 'Recepción RAHA E2E');
  });
  await step('05 Full catalogue, variants, pagination, search and tenant isolation', async () => {
    const first = await merchantRequest('post', 'stock', { deposito_origen_id: origin.id, limit: 10, page: 1 });
    const second = await merchantRequest('post', 'stock', { deposito_origen_id: origin.id, limit: 10, page: 2 });
    assert.equal(first.total, 15);
    assert.equal(first.registros.length, 10);
    assert.equal(second.registros.length, 5);
    const rows = [...first.registros, ...second.registros];
    assert.equal(rows.find(row => row.producto_id === declared.id).stock_registrado, false);
    assert.equal(rows.find(row => row.producto_id === tracked.id).disponible, 7);
    assert.equal(rows.filter(row => row.producto_id === variantProduct.id).length, 1);
    assert.equal(rows.find(row => row.producto_id === variantProduct.id).variante_id, variant.id);
    assert.equal(rows.find(row => row.producto_id === variantProduct.id).producto.imagen_url, '/uploads/raha-e2e-variante.svg');
    assert(!rows.some(row => row.producto_id === foreignProduct.id));
    const search = await merchantRequest('post', 'stock', { deposito_origen_id: origin.id, texto: 'REM-AZUL' });
    assert.equal(search.total, 1);
    await merchantRequest('post', 'stock', { deposito_origen_id: foreignOrigin.id }, 404);
    return { catalogue_entries: first.total, page_sizes: [10, 5], stock_unallocated_visible: true, foreign_data_excluded: true };
  });
  await step('06 Four ordered full-width desktop actions and Abastecerme destination picker', async () => {
    await merchantPage.goto(`${preview}/mi-tienda/depositos`);
    const actions = merchantPage.getByRole('navigation', { name: 'Acciones de depósitos' });
    await expect(actions).toBeVisible();
    assert.deepEqual((await actions.getByRole('button').allTextContents()).map(label => label.trim()), ['Agregar depósito', 'Abastecerme', 'Ver RAHA', 'Enviar mercadería a RAHA']);
    const rectangles = await actions.getByRole('button').evaluateAll(buttons => buttons.map(button => { const bounds = button.getBoundingClientRect(); return { top: bounds.top, width: bounds.width }; }));
    assert(rectangles.every(rectangle => rectangle.top === rectangles[0].top));
    await actions.getByRole('button', { name: 'Abastecerme', exact: true }).click();
    await expect(merchantPage.getByLabel('Depósito de destino')).toHaveValue(String(origin.id));
    await merchantPage.screenshot({ path: path.join(artifacts, 'depositos-desktop.png'), fullPage: true });
    await merchantPage.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await actions.getByRole('button', { name: 'Enviar mercadería a RAHA' }).click();
    await expect(merchantPage).toHaveURL(/mis-envios-raha/);
  });
  await step('07 Browser requests unallocated catalogue merchandise without inventing stock', async () => {
    await merchantPage.getByRole('button', { name: 'Nueva solicitud', exact: true }).click();
    await merchantPage.getByLabel('Depósito de origen').selectOption(String(origin.id));
    await merchantPage.getByLabel('Depósito RAHA de destino').selectOption(String(destination.id));
    await expect(merchantPage.getByRole('button', { name: /Producto sin ubicación E2E/ })).toBeVisible();
    await merchantPage.getByRole('button', { name: 'Siguiente', exact: true }).click();
    await expect(merchantPage.getByRole('button', { name: /Catálogo público E2E 11/ })).toBeVisible();
    await merchantPage.getByRole('button', { name: 'Anterior', exact: true }).click();
    await merchantPage.getByLabel('Buscar en el catálogo de productos').fill('DECL-E2E');
    await merchantPage.getByRole('button', { name: /Producto sin ubicación E2E/ }).click();
    await merchantPage.getByLabel('Cantidad', { exact: true }).fill('3');
    await merchantPage.getByLabel('Observaciones para RAHA').fill('Recepción E2E de cantidad declarada');
    const selectedImage = merchantPage.getByRole('listitem').getByRole('img', { name: 'Foto de Producto sin ubicación E2E' });
    await expect(selectedImage).toBeVisible();
    await expect.poll(() => selectedImage.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    await merchantPage.screenshot({ path: path.join(artifacts, 'catalogo-cantidad-declarada.png'), fullPage: true });
    await merchantPage.getByRole('button', { name: 'Enviar solicitud a RAHA' }).click();
    await expect(merchantPage.getByRole('status').filter({ hasText: 'enviada a RAHA' })).toBeVisible();
    [shipment] = (await merchantRequest('post', 'envios/listado', {})).registros;
    assert.equal(shipment.items[0].stock_registrado, false);
    assert.equal(shipment.items[0].imagen_url, '/uploads/raha-e2e.svg');
    assert.equal(await models.InventarioUbicacion.count({ where: { producto_id: declared.id } }), 0);
    await merchantPage.screenshot({ path: path.join(artifacts, 'solicitud-desktop.png'), fullPage: true });
  });
  await step('08 Merchant prepares and sends; RAHA alone confirms receipt with history', async () => {
    for (const label of ['Marcar como preparado', 'Marcar como enviado']) {
      await merchantPage.getByRole('button', { name: label, exact: true }).click();
      await merchantPage.getByRole('button', { name: 'Confirmar cambio', exact: true }).click();
      await expect(merchantPage.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
    await merchantRequest('post', `envios/${shipment.id}/resolver`, { estado: 'recibido', version: 2 }, 409);
    await portalPage.getByRole('button', { name: 'Envíos a RAHA', exact: true }).click();
    await portalPage.getByRole('button', { name: `Ver solicitud de envío ${shipment.id}` }).click();
    await portalPage.getByRole('button', { name: 'Marcar como recibido', exact: true }).click();
    await portalPage.getByRole('button', { name: 'Confirmar cambio', exact: true }).click();
    await expect(portalPage.getByRole('status').filter({ hasText: 'actualizado' })).toBeVisible();
    const result = await merchantRequest('get', `envios/${shipment.id}`);
    assert.equal(result.estado, 'recibido');
    assert.deepEqual(result.historial.map(event => event.estado), ['solicitada', 'preparado', 'enviado', 'recibido']);
    assert.equal(result.historial.at(-1).raha_portal_usuario_id, operator.id);
    await inventory.reload();
    assert.equal(inventory.cantidad_disponible, 7);
    assert.equal(await models.InventarioUbicacion.count({ where: { producto_id: declared.id } }), 0);
    await portalPage.screenshot({ path: path.join(artifacts, 'recepcion-desktop.png'), fullPage: true });
    return { final_state: result.estado, history: result.historial.map(event => event.estado), automatic_stock_movement: false };
  });
  await step('09 Real idempotency, parallel retries, stock validation and optimistic locking', async () => {
    const payload = { deposito_origen_id: origin.id, destino_raha_id: destination.id, solicitud_key: crypto.randomUUID(),
      items: [{ producto_id: tracked.id, cantidad: 2 }] };
    const [first, retry] = await Promise.all([merchantRequest('post', 'envios', payload), merchantRequest('post', 'envios', payload)]);
    assert.equal(first.id, retry.id);
    await merchantRequest('post', 'envios', { ...payload, items: [{ producto_id: tracked.id, cantidad: 3 }] }, 409);
    await merchantRequest('post', 'envios', { ...payload, solicitud_key: crypto.randomUUID(), items: [{ producto_id: tracked.id, cantidad: 8 }] }, 409);
    await merchantRequest('post', 'envios', { ...payload, solicitud_key: crypto.randomUUID(), items: [{ producto_id: foreignProduct.id, cantidad: 1 }] }, 409);
    const changes = await Promise.all(['preparado', 'cancelada'].map(estado => merchant.request.post(`${api}/integraciones/raha/operaciones/envios/${first.id}/resolver`, { data: { estado, version: 0 } })));
    assert.deepEqual(changes.map(response => response.status()).sort(), [200, 409]);
    await portalRequest('post', `envios/${first.id}/resolver`, { estado: 'recibido', version: 1 }, 409);
    return { concurrent_retry_same_id: true, concurrent_state_updates: [200, 409] };
  });
  await step('10 Real filtering, scoped access, destination snapshots and safe migration rollback', async () => {
    const filtered = await merchantRequest('post', 'envios/listado', { estado: 'recibido', texto: 'sin ubicación', limit: 1 });
    assert.equal(filtered.total, 1);
    await merchantRequest('post', 'envios/listado', { desde: '2026-02-31' }, 400);
    await request(foreign, 'get', `integraciones/raha/operaciones/envios/${shipment.id}`, undefined, 404);
    assert.equal((await request(foreign, 'post', 'integraciones/raha/operaciones/envios/listado', {})).total, 0);
    await request(foreign, 'post', 'raha-portal/operaciones/envios/listado', {}, 401);
    await portalRequest('put', `destinos/${destination.id}`, { ...Object.fromEntries(['nombre', 'ciudad', 'direccion', 'persona_contacto', 'telefono_contacto'].map(key => [key, destination[key]])), direccion: 'Dirección nueva 456', activo: false });
    assert.equal((await merchantRequest('get', 'destinos')).length, 0);
    assert.equal((await merchantRequest('get', `envios/${shipment.id}`)).destino_snapshot.direccion, 'Avenida España 123');
    await assert.rejects(require('../migrations/20261019160000-raha-envios-estados-logisticos').down(models.sequelize.getQueryInterface()));
  });
  await step('11 Mobile 390px, persisted receipt and no page errors', async () => {
    for (const [page, url, screenshot] of [[merchantPage, '/mi-tienda/depositos', 'depositos-mobile.png'], [merchantPage, '/mis-envios-raha', 'envios-mobile.png'], [portalPage, '/raha/solicitudes?tab=envios', 'recepcion-mobile.png']]) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${preview}${url}`);
      await expect(page.getByRole('heading', { name: url.includes('depositos') ? 'Depósitos' : 'Envíos de mercadería a RAHA', exact: true })).toBeVisible();
      if (!url.includes('depositos')) await expect(page.getByRole('table').getByText('Recibido', { exact: true })).toBeVisible();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow: ${url}`);
      await page.screenshot({ path: path.join(artifacts, screenshot), fullPage: true });
    }
    assert.deepEqual(pageErrors, []);
    return { mobile_width: 390, page_errors: pageErrors };
  });
  await step('12 Genuine supply queries and browser tracking from persisted RAHA events', async () => {
    const results = await portalRequest('post', 'abastecimientos', { estado: 'en_camino', texto: 'Termo', limit: 10 });
    assert.equal(results.total, 1);
    assert.equal(results.registros[0].estado_seguimiento, 'en_camino');
    assert(!JSON.stringify(results).includes('must-not-be-exposed'));
    const details = await portalRequest('get', `abastecimientos/${supply.id}`);
    assert.deepEqual(details.historial_raha.map(event => event.estado), ['en_camino']);
    const merchantSupplies = await request(merchant, 'get', 'solicitudes-abastecimiento?vista=raha&estado=en_camino&page=1&limit=10');
    assert.equal(merchantSupplies.total, 1);
    assert.equal(merchantSupplies.solicitudes[0].inventario.disponible, 7);
    assert.equal(merchantSupplies.solicitudes[0].modalidad_pago, 'CONTRA_ENTREGA');
    await merchantPage.setViewportSize({ width: 1440, height: 1000 });
    await merchantPage.goto(`${preview}/mis-abastecimientos`);
    await merchantPage.getByRole('link', { name: `Ver seguimiento del abastecimiento ${supply.id}` }).click();
    await expect(merchantPage.getByRole('heading', { name: 'Historial de movimientos', exact: true })).toBeVisible();
    await merchantPage.screenshot({ path: path.join(artifacts, 'abastecimiento-seguimiento.png'), fullPage: true });
    await portalPage.setViewportSize({ width: 1440, height: 1000 });
    await portalPage.getByRole('button', { name: 'Abastecimientos', exact: true }).click();
    await portalPage.getByRole('button', { name: `Ver abastecimiento ${supply.id}` }).click();
    await expect(portalPage.getByRole('heading', { name: 'Historial logístico', exact: true })).toBeVisible();
    await portalPage.screenshot({ path: path.join(artifacts, 'portal-abastecimientos.png'), fullPage: true });
    assert.deepEqual(pageErrors, []);
    return { remote_order_id_preserved: true, cross_owner_event_filtered: true, payment_receipt_required: false, external_provider_contacted: false };
  });
  await step('13 Same-owner second store isolation and products without active variants', async () => {
    const secondStore = await models.Tienda.create({ usuario_id: user.id, inquilino_id: tenant.id, nombre: 'Segunda tienda E2E', subdominio: 'segunda-raha-e2e' });
    const secondDepot = await models.Deposito.create({ usuario_id: user.id, tienda_id: secondStore.id, nombre: 'Depósito segunda tienda', ciudad: 'Luque', direccion: 'Segunda calle 200' });
    await models.Producto.create({ ...productData, tienda_id: secondStore.id, nombre: 'Privado segunda tienda', slug: 'segunda-tienda-privado' });
    await models.Producto.create({ ...productData, creado_por: null, tienda_id: secondStore.id, nombre: 'Sin creador segunda tienda', slug: 'segunda-tienda-sin-creador' });
    const inactiveParent = await models.Producto.create({ ...productData, nombre: 'Todas las variantes inactivas', slug: 'variantes-inactivas-e2e' });
    await models.ProductoVariante.create({ producto_id: inactiveParent.id, inquilino_id: tenant.id, nombre: 'Inactiva', activo: false });
    const originalRows = await merchantRequest('post', 'stock', { deposito_origen_id: origin.id, limit: 100 });
    assert.equal(originalRows.total, 15);
    await merchantRequest('post', 'stock', { deposito_origen_id: secondDepot.id }, 404);
    await request(merchant, 'post', 'auth/seleccionar-tienda', { tienda_id: secondStore.id });
    await merchantRequest('get', `envios/${shipment.id}`, undefined, 404);
    await merchantRequest('post', 'stock', { deposito_origen_id: origin.id }, 404);
    const secondRows = await merchantRequest('post', 'stock', { deposito_origen_id: secondDepot.id, limit: 100 });
    assert(!secondRows.registros.some(row => row.producto_id === declared.id));
    return { other_store_depot_denied: true, private_products_isolated: true, inactive_variants_excluded: true };
  });
}

main().catch(error => { report.error = error.stack; console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (report.error) for (const [index, page] of (resources.pages || []).entries()) {
    await page.screenshot({ path: path.join(artifacts, `failure-${index}.png`), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(artifacts, `failure-${index}.html`), await page.content().catch(() => ''));
  }
  await resources.browser?.close().catch(() => {});
  if (resources.vite && resources.vite.exitCode == null) {
    resources.vite.kill();
    await new Promise(resolve => { const timer = setTimeout(resolve, 5000); resources.vite.once('exit', () => { clearTimeout(timer); resolve(); }); });
  }
  for (const server of resources.servers) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  await resources.sequelize?.close().catch(() => {});
  if (resources.postgres) {
    try { pg('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop']); } catch (error) { report.cleanup_error = error.message; process.exitCode = 1; }
  }
  global.fetch = nativeFetch;
  report.finished_at = new Date().toISOString();
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Report: ${path.join(artifacts, 'report.json')}`);
});
