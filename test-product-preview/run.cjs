'use strict';

const fs = require('node:fs'),
  path = require('node:path'),
  net = require('node:net'),
  http = require('node:http'),
  crypto = require('node:crypto');
const {
  spawn,
  execFileSync
} = require('node:child_process');
const backend = path.resolve(__dirname, '..'),
  frontend = path.resolve(backend, '../gesicomm-frontend');
const out = path.resolve(backend, `../outputs/product-preview-e2e-${Date.now()}`);
fs.mkdirSync(out, {
  recursive: true
});
const report = {
    scope: 'Real browser + Express + disposable PostgreSQL; no business API mocks',
    steps: []
  },
  resources = {};
const pgBin = process.env.RAHA_E2E_PG_BIN || 'C:/Program Files/PostgreSQL/17/bin',
  dataDir = path.join(out, 'postgres');
function pg(cmd, args) {
  const fd = fs.openSync(path.join(out, 'postgres.log'), 'a');
  try {
    execFileSync(path.join(pgBin, cmd + '.exe'), args, {
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      timeout: 60000
    });
  } finally {
    fs.closeSync(fd);
  }
}
async function port() {
  const s = net.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}
async function main() {
  const dbPort = await port();
  pg('initdb', ['-D', dataDir, '-U', 'product_e2e', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
  pg('pg_ctl', ['-D', dataDir, '-l', path.join(out, 'postgres-server.log'), '-o', `-h 127.0.0.1 -p ${dbPort} -F`, '-w', 'start']);
  resources.pg = true;
  pg('createdb', ['-h', '127.0.0.1', '-p', String(dbPort), '-U', 'product_e2e', 'product_e2e']);
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DB_HOST: '127.0.0.1',
    DB_PORT: String(dbPort),
    DB_NAME: 'product_e2e',
    DB_USER: 'product_e2e',
    DB_PASSWORD: '',
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    REFRESH_TOKEN_SECRET: crypto.randomBytes(32).toString('hex'),
    ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    SMTP_USER: '',
    SMTP_PASS: '',
    BREVO_API_KEY: '',
    SPEEDBOX_ENABLED: 'false',
    BASE_DOMAIN: 'localhost',
    APP_HOSTNAME: 'localhost'
  });
  const m = require('../src/models');
  resources.db = m.sequelize;
  m.sequelize.options.logging = false;
  for (const model of Object.values(m.sequelize.models)) {
    for (const a of Object.values(model.rawAttributes)) delete a.comment;
    model.refreshAttributes();
  }
  await m.sequelize.sync();
  const qi = m.sequelize.getQueryInterface();
  const columns = await qi.describeTable(m.Landing.getTableName());
  for (const [name, attribute] of Object.entries(m.Landing.rawAttributes)) if (!columns[name]) await qi.addColumn(m.Landing.getTableName(), name, attribute);
  const tenant = await m.Inquilino.create({
      nombre: 'Producto E2E'
    }),
    role = await m.Rol.create({
      nombre: 'administrador'
    }),
    password = 'E2E-' + crypto.randomBytes(12).toString('hex');
  const user = await m.Usuario.create({
    nombre: 'Producto E2E',
    correo_electronico: 'producto@preview-e2e.test',
    contrasena_hash: await require('bcryptjs').hash(password, 4),
    email_verificado: true,
    inquilino_id: tenant.id,
    rol_id: role.id
  });
  const tienda = await m.Tienda.create({
    usuario_id: user.id,
    inquilino_id: tenant.id,
    nombre: 'Tienda de prueba E2E',
    subdominio: 'product-e2e',
    color_primario: '#7438c8',
    color_secundario: '#eaad39',
    color_fondo: '#111b29',
    whatsapp: '595981000000'
  });
  const plan = await m.Plan.create({
    codigo: 'product-e2e',
    nombre: 'Plan E2E',
    precio: 10000,
    features: ['tienda']
  });
  await m.Suscripcion.create({
    usuario_id: user.id,
    plan_id: plan.id,
    email: user.correo_electronico,
    estado: 'activa',
    precio_pagado: 10000,
    periodo_inicio: new Date(),
    periodo_fin: new Date(Date.now() + 86400000 * 30)
  });
  const template = await m.LandingTemplate.create({
    name: 'Lienzo',
    slug: 'lienzo-blanco',
    kind: 'codigo',
    status: 'published'
  });
  const producto = await m.Producto.create({
    inquilino_id: tenant.id,
    creado_por: user.id,
    tienda_id: tienda.id,
    nombre: 'Producto original E2E',
    slug: 'producto-e2e',
    sku: 'PRODUCTO-E2E',
    precio_base: 100000,
    precio_costo: 20000,
    activo: true,
    estado_venta: 'en_venta',
    ficha_datos: {}
  });
  const landing = await m.Landing.create({
    inquilino_id: tenant.id,
    tienda_id: tienda.id,
    template_id: template.id,
    nombre: 'Publicada E2E',
    slug: 'producto-preview-e2e',
    tipo_pagina: 'inicio',
    activo: true,
    content: {
      venta: {
        configurado: true,
        seleccion: 'manual'
      }
    }
  });
  await m.LandingItem.create({
    landing_id: landing.id,
    tipo: 'producto',
    referencia_id: producto.id
  });
  const express = require('express'),
    app = express();
  app.use(require('cors')({
    origin: true,
    credentials: true
  }));
  app.use(express.json());
  app.use(require('cookie-parser')());
  for (const [mount, file] of [['auth', 'auth'], ['mi-tienda', 'tienda'], ['tiendas', 'tiendas'], ['productos', 'productos'], ['mis-landings-simples', 'landingSimple'], ['l', 'landingPublica'], ['categorias', 'categorias'], ['proveedores', 'proveedores'], ['combos', 'combos-admin'], ['depositos', 'depositoRoutes'], ['educacion', 'educacionRoutes'], ['vitrina', 'vitrina'], ['solicitudes-abastecimiento', 'solicitudAbastecimientoRoutes'], ['seguimiento', 'seguimientoRoutes'], ['admin/auth-tracking', 'adminAuthTracking'], ['envios', 'envioRoutes'], ['config/payment-gateways', 'payment-gateways']]) app.use('/api/' + mount, require('../src/routes/' + file));
  app.use('/api', require('../src/routes/suscripciones'));
  app.use((err, req, res, next) => res.status(err.status || 500).json({
    message: err.message
  }));
  resources.server = http.createServer(app);
  await new Promise(r => resources.server.listen(0, '127.0.0.1', r));
  const api = `http://localhost:${resources.server.address().port}`;
  const uiPort = await port(),
    ui = `http://localhost:${uiPort}`;
  const fd = fs.openSync(path.join(out, 'vite.log'), 'a');
  resources.vite = spawn(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), '--host', 'localhost', '--port', String(uiPort), '--strictPort'], {
    cwd: frontend,
    env: {
      ...process.env,
      VITE_API_URL: api
    },
    windowsHide: true,
    stdio: ['ignore', fd, fd]
  });
  for (let n = 0; n < 120; n++) {
    try {
      if ((await fetch(ui)).ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  const {
    chromium,
    expect
  } = require(require.resolve('@playwright/test', {
    paths: [frontend]
  }));
  resources.browser = await chromium.launch();
  const ctx = await resources.browser.newContext({
      viewport: {
        width: 1440,
        height: 1000
      }
    }),
    page = await ctx.newPage();
  resources.page = page;
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => {
    if (r.status() >= 400 && r.url().includes('/api/')) console.log('HTTP', r.status(), new URL(r.url()).pathname);
  });
  const login = await ctx.request.post(api + '/api/auth/login', {
    data: {
      email: user.correo_electronico,
      password
    }
  });
  expect(login.status()).toBe(200);
  await page.goto(`${ui}/products/${producto.id}/editar`);
  await page.getByRole('button', {
    name: /Vista del producto/
  }).click();
  const editor = page.getByRole('region', {
    name: 'Bloques de la página del producto',
    exact: true
  });
  await editor.getByRole('button', {
    name: /Presentación/
  }).click();
  await editor.getByLabel('Nombre comercial', {
    exact: true
  }).fill('Nombre comercial E2E');
  await editor.getByRole('button', {
    name: 'Bloques del producto'
  }).click();
  await editor.getByRole('button', {
    name: /Opiniones y estrellas/
  }).click();
  await editor.getByLabel('Estrellas comerciales').fill('3.5');
  const frame = page.frameLocator('.product-preview-panel iframe');
  await expect(frame.locator('h1[data-gesicomm-bind="nombre"]')).toHaveText('Nombre comercial E2E');
  await expect(frame.locator('[data-gesicomm-bind="resenas_estrellas"]').first()).toHaveAttribute('aria-label', /3[,.]5/);
  const snapshot = async f => ({
    nombre: await f.locator('h1[data-gesicomm-bind="nombre"]').textContent(),
    estrellas: await f.locator('[data-gesicomm-bind="resenas_estrellas"]').first().getAttribute('aria-label'),
    color: await f.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)
  });
  const preview = await snapshot(frame);
  await page.screenshot({
    path: path.join(out, 'preview-desktop.png')
  });
  const saved = page.waitForResponse(r => r.url().endsWith(`/api/productos/${producto.id}`) && r.request().method() === 'PUT');
  await page.getByRole('button', {
    name: 'Guardar',
    exact: true
  }).first().click();
  expect((await saved).status()).toBe(200);
  await producto.reload();
  expect(producto.ficha_datos.presentacion).toMatchObject({
    titulo_comercial: 'Nombre comercial E2E',
    resenas_calificacion: '3.5'
  });
  report.steps.push({
    name: 'Edit and persist through real API',
    passed: true
  });
  await page.goto(`${ui}/products/${producto.id}/editar`);
  await page.getByRole('button', {
    name: /Vista del producto/
  }).click();
  await editor.getByRole('button', {
    name: /Presentación/
  }).click();
  await expect(editor.getByLabel('Nombre comercial', {
    exact: true
  })).toHaveValue('Nombre comercial E2E');
  await editor.getByRole('button', {
    name: 'Bloques del producto'
  }).click();
  await editor.getByRole('button', {
    name: /Opiniones y estrellas/
  }).click();
  await expect(editor.getByLabel('Estrellas comerciales')).toHaveValue('3.5');
  report.steps.push({
    name: 'Reload saved product',
    passed: true
  });
  const publicCtx = await resources.browser.newContext({
      viewport: {
        width: 1440,
        height: 1000
      }
    }),
    published = await publicCtx.newPage();
  resources.publicPage = published;
  published.on('pageerror', e => errors.push(e.message));
  await published.goto(`${ui}/l/${landing.slug}/${producto.slug}`);
  console.log('PUBLIC', await published.locator('body').innerText());
  const publicFrame = published.frameLocator('iframe').first();
  await expect(publicFrame.locator('h1[data-gesicomm-bind="nombre"]')).toHaveText(preview.nombre);
  const publicSnapshot = await snapshot(publicFrame);
  expect(publicSnapshot).toEqual(preview);
  await published.screenshot({
    path: path.join(out, 'public-desktop.png')
  });
  await published.setViewportSize({
    width: 390,
    height: 844
  });
  await expect(publicFrame.locator('h1[data-gesicomm-bind="nombre"]')).toHaveText(preview.nombre);
  await expect(publicFrame.locator('[data-gesicomm-bind="resenas_estrellas"]').first()).toHaveAttribute('aria-label', preview.estrellas);
  await published.screenshot({
    path: path.join(out, 'public-mobile.png')
  });
  expect(errors).toEqual([]);
  report.steps.push({
    name: 'Anonymous published page equals preview on desktop and mobile',
    passed: true,
    preview,
    published: publicSnapshot
  });
  console.log('PASS', JSON.stringify(report.steps));
}
main().catch(e => {
  report.error = e.stack;
  console.error(e.stack, e.original?.message || '');
  process.exitCode = 1;
}).finally(async () => {
  if (report.error && resources.page) {
    await resources.page.screenshot({
      path: path.join(out, 'failure.png')
    }).catch(() => {});
    fs.writeFileSync(path.join(out, 'failure.html'), await resources.page.content().catch(() => ''));
  }
  if (report.error && resources.publicPage) await resources.publicPage.screenshot({
    path: path.join(out, 'public-failure.png')
  }).catch(() => {});
  await resources.browser?.close();
  resources.vite?.kill();
  if (resources.server) {
    resources.server.closeAllConnections?.();
    await new Promise(r => resources.server.close(r));
  }
  await resources.db?.close();
  if (resources.pg) pg('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop']);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Report:', path.join(out, 'report.json'));
});
