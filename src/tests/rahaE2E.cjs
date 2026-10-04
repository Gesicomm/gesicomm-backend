'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({ step, request: runRequest, page, context, browser, api, preview, expect, m, user, other, admin, password, artifacts, pageErrors, report }) => {
  const request = (method, endpoint, data, expected, ctx) => runRequest(method, endpoint, method === 'get' ? undefined : data, expected, ctx);
  const base = 'integraciones/raha', adminCtx = await browser.newContext(), otherCtx = await browser.newContext(), anon = await browser.newContext(), alienCtx = await browser.newContext();
  const tenant = await m.Inquilino.create({ nombre: 'Other Raha tenant' });
  const alien = await m.Usuario.create({ nombre: 'Alien admin', correo_electronico: 'alien@example.test', contrasena_hash: admin.contrasena_hash, email_verificado: true, inquilino_id: tenant.id, rol_id: admin.rol_id });
  let row;
  const datos = { razon_social: 'Empresa E2E', ruc: '80000000-0', representante: 'Representante E2E', cedula: '1234567', email: 'raha-e2e@example.test', telefono: '0981000000', direccion: 'Lopez 1234', ciudad: 'Asuncion', departamento: 'Central', actividad_economica: 'Comercio minorista', tipo_productos: 'Indumentaria y accesorios', operaciones_mensuales: '120', banco: 'Banco E2E', titular_cuenta: 'Empresa E2E', numero_cuenta: '0012345', moneda: 'PYG' };
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj <</Type /Catalog>> endobj\n%%EOF');
  const png = await require('sharp')({ create: { width: 50, height: 50, channels: 3, background: '#28664d' } }).png().toBuffer();
  const docId = () => row.documentos.find(doc => doc.tipo === 'ruc').id;
  async function upload(tipo, name, mimeType, buffer, expected = 200) {
    const res = await context.request.post(`${api}/api/${base}/documentos`, { multipart: { tipo, version: String(row.version), archivo: { name, mimeType, buffer } } });
    const body = await res.json(); assert.equal(res.status(), expected, JSON.stringify(body)); if (res.ok()) row = body;
  }
  const review = (data, expected = 200) => request('post', `${base}/admin/${row.id}/revisar`, { version: row.version, ...data }, expected, adminCtx.request);
  try {
    for (const [who, ctx] of [[admin, adminCtx], [other, otherCtx], [alien, alienCtx]]) await request('post', 'auth/login', { email: who.correo_electronico, password }, 200, ctx.request);
    await step('37 Raha draft form, required data, consent and preserved inputs', async () => {
      row = await request('get', base); assert.equal(row.estado, 'borrador');
      await request('get', `${base}/admin/${row.id}`, null, 404, adminCtx.request);
      assert.equal((await request('get', `${base}/admin`, null, 200, adminCtx.request)).total, 0);
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`${preview}/mi-tienda?tab=raha`);
      await expect(page.getByLabel('Tipo de productos que vendés')).toBeVisible(); assert.equal(await page.locator('.tn-panel form').count(), 1);
      const labels = { razon_social: 'Razón social', ruc: 'RUC', representante: 'Nombre del representante legal', cedula: 'Cédula del representante legal', email: 'Email', telefono: 'Teléfono', direccion: 'Dirección', ciudad: 'Ciudad', departamento: 'Departamento', actividad_economica: 'Actividad económica', tipo_productos: 'Tipo de productos que vendés', operaciones_mensuales: 'Volumen estimado de operaciones por mes', banco: 'Banco', titular_cuenta: 'Titular de la cuenta', numero_cuenta: 'Número de cuenta' };
      for (const [key, label] of Object.entries(labels)) await page.getByLabel(label, { exact: true }).fill(datos[key]);
      await page.getByRole('button', { name: 'Guardar borrador' }).click(); await expect(page.getByText('Borrador guardado.', { exact: true })).toBeVisible(); row = await request('get', base);
      assert.equal(row.datos.numero_cuenta, '0012345'); await request('put', base, { datos, version: 0 }, 409);
      await request('post', `${base}/enviar`, { datos, version: row.version, consentimiento: false }, 400);
      await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Enviar solicitud' }).click(); await expect(page.getByRole('alert')).toContainText('constancia de RUC');
      await expect(page.getByLabel('Tipo de productos que vendés')).toHaveValue(datos.tipo_productos); return { draft_private: true, stale_edit: 409, consent_required: true, one_form: true };
    });
    await step('38 Raha real uploads, spoofing rejection and private owner/tenant access', async () => {
      await upload('ruc', 'spoof.pdf', 'application/pdf', Buffer.from('fake'), 400); await upload('ruc', 'svg.svg', 'image/svg+xml', Buffer.from('<svg/>'), 400); await upload('ruc', 'large.pdf', 'application/pdf', Buffer.alloc(8 * 1024 * 1024 + 1), 400);
      await page.getByLabel('Adjuntar Constancia de RUC').setInputFiles({ name: 'ruc.pdf', mimeType: 'application/pdf', buffer: pdf }); await expect(page.getByRole('button', { name: 'Descargar ruc.pdf', exact: true })).toBeVisible(); row = await request('get', base);
      await page.getByLabel('Adjuntar Cédula del representante legal').setInputFiles({ name: 'cedula.png', mimeType: 'image/png', buffer: png }); await expect(page.getByRole('button', { name: 'Descargar cedula.jpg', exact: true })).toBeVisible(); row = await request('get', base); await upload('productos', 'producto.png', 'image/png', png);
      assert(!JSON.stringify(row).includes('storage_key')); const res = await context.request.get(`${api}/api/${base}/documentos/${docId()}`); assert.equal(res.status(), 200); assert.equal(res.headers()['cache-control'], 'private, no-store'); assert.deepEqual(await res.body(), pdf);
      for (const [ctx, status] of [[anon, 401], [otherCtx, 404], [alienCtx, 404]]) await request('get', `${base}/documentos/${docId()}`, null, status, ctx.request);
      await request('get', `${base}/admin`, null, 403); await page.reload(); await expect(page.getByLabel('Tipo de productos que vendés')).toHaveValue(datos.tipo_productos); return { private_download: true, documents: row.documentos.length, spoofing: 400, anonymous: 401, wrong_owner_tenant: 404 };
    });
    await step('39 Raha submission replay, snapshot, notifications and editing locks', async () => {
      await page.getByRole('checkbox').check(); const version = row.version; await page.getByRole('button', { name: 'Enviar solicitud' }).click(); await expect(page.getByText('Solicitud presentada a Gesicom para revisión manual.', { exact: true })).toBeVisible(); row = await request('get', base);
      const repeated = await request('post', `${base}/enviar`, { datos, version, consentimiento: true }); assert.equal(repeated.version, row.version); assert.equal(repeated.historial.length, 1);
      await request('put', base, { datos, version: row.version }, 409); await upload('adicional', 'later.pdf', 'application/pdf', pdf, 409); await request('delete', `${base}/documentos/${docId()}`, { version: row.version }, 409);
      assert.equal(await m.Notificacion.count({ where: { usuario_id: admin.id, entidad_tipo: 'raha_solicitud_admin', entidad_id: row.id } }), 1); await request('get', `${base}/admin/${row.id}`, null, 404, alienCtx.request); return { one_snapshot: true, one_notification: true, immutable_pending: true };
    });
    await step('40 Raha admin ZIP download, correction note and resubmission', async () => {
      const adminPage = await adminCtx.newPage(); adminPage.on('pageerror', e => pageErrors.push(e.message)); await adminPage.goto(`${preview}/admin/raha?solicitud=${row.id}`); await expect(adminPage.getByText(datos.numero_cuenta, { exact: true })).toBeVisible();
      const pending = adminPage.waitForEvent('download'); await adminPage.getByRole('button', { name: 'Descargar expediente' }).click(); const download = await pending; const name = path.join(artifacts, 'raha-expediente.zip'); await download.saveAs(name);
      for (const width of [1440, 390]) {
        await adminPage.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        await adminPage.evaluate(() => Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect?.getTiming().iterations)).map(a => a.finished.catch(() => {}))));
        assert(await adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await adminPage.screenshot({ path: path.join(artifacts, `raha-admin-${width}.png`), fullPage: true });
      }
      await adminPage.setViewportSize({ width: 1440, height: 1000 });
      const zip = await require('jszip').loadAsync(fs.readFileSync(name)); assert(zip.file('resumen.pdf')); assert(zip.file('solicitud.json')); assert.deepEqual(await zip.file(`ruc/${docId()}-ruc.pdf`).async('nodebuffer'), pdf); assert.equal(JSON.parse(await zip.file('solicitud.json').async('string')).datos.tipo_productos, datos.tipo_productos);
      await request('get', `${base}/admin/${row.id}/expediente`, null, 403); await request('get', `${base}/admin/${row.id}/expediente`, null, 404, alienCtx.request);
      await adminPage.getByLabel('Nota para el comercio').fill('Adjuntar imagen legible de la cedula.'); await adminPage.getByRole('button', { name: 'Registrar resultado' }).click(); await expect(adminPage.locator('.raha-details .raha-badge')).toHaveText('Requiere correcciones');
      await page.reload(); await expect(page.getByLabel('RUC', { exact: true })).toBeEnabled(); row = await request('get', base); await upload('cedula', 'cedula-corregida.png', 'image/png', png);
      await request('post', `${base}/enviar`, { datos, version: row.version, consentimiento: false }, 400); row = await request('post', `${base}/enviar`, { datos, version: row.version, consentimiento: true }); assert.equal(row.historial.length, 3); await adminPage.close(); return { archive: 'raha-expediente.zip', corrections_and_renewed_consent: true };
    });
    await step('41 Raha manual forwarding and approval evidence with guarded transitions', async () => {
      await review({ estado: 'aprobada', nota: 'No se envio.', referencia: 'fake' }, 409); await review({ estado: 'enviada_raha', nota: 'Sin referencia.' }, 400);
      const version = row.version; row = await review({ estado: 'enviada_raha', nota: 'Envio simulado solo para prueba.', referencia: 'E2E-simulated-email-001' }); await request('post', `${base}/admin/${row.id}/revisar`, { version, estado: 'observada', nota: 'Datos viejos.' }, 409, adminCtx.request);
      await review({ estado: 'aprobada', nota: 'Sin referencia.' }, 400); row = await review({ estado: 'aprobada', nota: 'Aprobacion simulada solo para prueba.', referencia: 'E2E-simulated-approval-001' }); await review({ estado: 'rechazada', nota: 'No modificar decision final.' }, 409); assert.equal(row.historial.length, 5);
      report.raha = { solicitud_id: row.id, estado: row.estado, historial: row.historial.map(({ datos, documentos, ...entry }) => entry) }; return { sending_and_approval_simulated_not_real: true, reference_required: true, stale_review: 409 };
    });
    await step('42 Raha desktop/mobile screenshots without overflow or browser errors', async () => {
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport); await page.goto(`${preview}/mi-tienda?tab=raha`); await expect(page.getByLabel('Tipo de productos que vendés')).toHaveValue(datos.tipo_productos); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert(await page.locator('.raha').evaluate(el => el.scrollWidth <= el.clientWidth)); await page.screenshot({ path: path.join(artifacts, `raha-${viewport.width}.png`), fullPage: true });
        await page.getByRole('heading', { name: 'Documentos e imágenes' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(artifacts, `raha-docs-${viewport.width}.png`) });
      }
      assert.deepEqual(pageErrors, []); return { viewports: [1440, 390], browser_errors: [] };
    });
    await step('43 Raha attachment quota, editable deletion and separate editable demo account', async () => {
      await m.Tienda.create({ usuario_id: other.id, inquilino_id: other.inquilino_id, nombre: 'Raha demo', subdominio: 'raha-demo' });
      const plan = await m.Plan.findOne();
      await m.Suscripcion.create({ usuario_id: other.id, plan_id: plan.id, email: other.correo_electronico, estado: 'activa', precio_pagado: 10000, periodo_inicio: new Date(), periodo_fin: new Date(Date.now() + 86400000 * 30) });
      let draft = await request('get', base, undefined, 200, otherCtx.request);
      for (let i = 0; i < 13; i++) {
        const response = await otherCtx.request.post(`${api}/api/${base}/documentos`, { multipart: { tipo: 'adicional', version: String(draft.version), archivo: { name: `document-${i}.pdf`, mimeType: 'application/pdf', buffer: pdf } } });
        assert.equal(response.status(), i < 12 ? 200 : 400); if (response.ok()) draft = await response.json();
      }
      const version = draft.version;
      const deletedKeys = await m.RahaDocumento.findAll({ where: { solicitud_id: draft.id }, attributes: ['storage_key'], raw: true });
      for (const doc of [...draft.documentos]) draft = await request('delete', `${base}/documentos/${doc.id}`, { version: draft.version }, 200, otherCtx.request);
      assert.equal(draft.documentos.length, 0); assert.equal(await m.RahaDocumento.count({ where: { solicitud_id: draft.id } }), 0);
      for (const doc of deletedKeys) assert(!fs.existsSync(path.join(artifacts, 'private-raha', doc.storage_key)));
      await request('put', base, { datos, version }, 409, otherCtx.request);
      draft = await request('put', base, { datos, version: draft.version }, 200, otherCtx.request);
      report.raha.editable_demo = { email: other.correo_electronico, solicitud_id: draft.id, estado: draft.estado };
      return { limit: 12, over_limit: 400, deletion_private_files: true, stale_version: 409, editable_demo: other.correo_electronico };
    });
  } finally { await Promise.all([adminCtx.close(), otherCtx.close(), anon.close(), alienCtx.close()]); }
};
