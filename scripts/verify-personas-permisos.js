'use strict';
// Verificación explícita en PostgreSQL. Todos los fixtures se revierten.
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const models = require('../src/models');
const Miembro = require('../src/models/TiendaMiembro');
const servicio = require('../src/services/accesos.service');
const db = models.sequelize;
db.options.logging = false;
(async () => {
  const originalTransaction = db.transaction.bind(db);
  let transaction;
  const restaurar = [];
  try {
    transaction = await originalTransaction();
    db.transaction = (options, callback) => typeof options === 'function' ? options(transaction) : originalTransaction(options, callback);
    // Todas las lecturas/escrituras del servicio comparten la transacción de prueba.
    for (const Model of [models.Usuario, models.Tienda, models.Rol, models.Inquilino, Miembro]) {
      for (const method of ['findAll', 'findOne', 'findByPk', 'create', 'findOrCreate']) {
        const original = Model[method];
        const index = ['findByPk', 'create'].includes(method) ? 1 : 0;
        Model[method] = function (...args) { args[index] = { ...args[index], transaction }; return original.apply(this, args); };
        restaurar.push(() => { Model[method] = original; });
      }
      const original = Model.prototype.update;
      Model.prototype.update = function (values, options) { return original.call(this, values, { ...options, transaction }); };
      restaurar.push(() => { Model.prototype.update = original; });
    }
    const suffix = crypto.randomBytes(6).toString('hex');
    const tenant = await models.Inquilino.create({ nombre: 'QA temporal accesos ' + suffix });
    const rol = await models.Rol.findOne({ where: { nombre: 'usuario' } });
    const propietario = await models.Usuario.create({ nombre: 'QA propietario', correo_electronico: `qa-owner-${suffix}@example.invalid`, contrasena_hash: 'no-login', inquilino_id: tenant.id, rol_id: rol.id, email_verificado: true });
    const tienda = await models.Tienda.create({ nombre: 'QA tienda', subdominio: 'qa-accesos-' + suffix, usuario_id: propietario.id, inquilino_id: tenant.id });
    const otraTienda = await models.Tienda.create({ nombre: 'QA otra tienda', subdominio: 'qa-accesos-otra-' + suffix, usuario_id: propietario.id, inquilino_id: tenant.id });
    const u = { id: propietario.id, tiendaId: tienda.id, tenantId: tenant.id, rol: 'usuario' };
    const alta = { nombre: 'QA alta directa', email: `qa-direct-${suffix}@example.invalid`, password: 'ClaveDirecta987', permisos: { comercial: 'gestionar' } };
    await assert.rejects(servicio.crear(u, { ...alta, password: 'corta' }), /contraseña/);
    const creada = await servicio.crear(u, alta);
    assert.equal(creada.token, undefined);
    const cuentaDirecta = await models.Usuario.findOne({ where: { correo_electronico: alta.email } });
    assert.equal(cuentaDirecta.email_verificado, true);
    assert.equal(cuentaDirecta.activo, true);
    assert.notEqual(cuentaDirecta.contrasena_hash, alta.password);
    assert.equal(await bcrypt.compare(alta.password, cuentaDirecta.contrasena_hash), true);
    assert.equal((await servicio.listarTiendas(cuentaDirecta.id))[0].id, tienda.id);
    await assert.rejects(servicio.crear(u, { ...alta, password: 'NoSobrescribir123' }), /ya tiene una cuenta/);
    assert.equal(await bcrypt.compare(alta.password, (await models.Usuario.findByPk(cuentaDirecta.id)).contrasena_hash), true);
    await servicio.actualizar(u, creada.id, { estado: 'revocado' });
    await servicio.actualizar(u, creada.id, { estado: 'activo', permisos: { comercial: 'ver' } });
    assert.equal((await Miembro.findByPk(creada.id)).estado, 'activo');
    const datos = { nombre: 'QA colaborador', email: `qa-member-${suffix}@example.invalid`, permisos: { comercial: 'ver' } };
    const { token } = await servicio.invitar(u, datos);
    assert.equal(token.length, 64);
    const persona = await models.Usuario.findOne({ where: { correo_electronico: datos.email } });
    const miembro = await Miembro.findOne({ where: { usuario_id: persona.id, tienda_id: tienda.id } });
    assert.notEqual(miembro.token_hash, token);
    assert.equal((await servicio.consultar(token)).existente, false);
    assert.equal((await servicio.listarTiendas(persona.id)).length, 0);
    await servicio.aceptar(token, 'PruebaAccesos987');
    assert.equal((await servicio.listarTiendas(persona.id)).length, 1);
    await assert.rejects(servicio.aceptar(token, 'PruebaAccesos987'), /inválida o vencida/);
    await servicio.actualizar(u, miembro.id, { permisos: { comercial: 'gestionar' } });
    await assert.rejects(servicio.actualizar({ ...u, tiendaId: otraTienda.id }, miembro.id, { permisos: { logistica: 'gestionar' } }), /Persona no encontrada/);
    assert.equal((await servicio.listarTiendas(persona.id))[0].id, tienda.id);
    assert.equal((await servicio.listar(u)).personas.find(p => p.id === miembro.id).permisos.comercial, 'gestionar');
    await assert.rejects(servicio.actualizar({ ...u, id: persona.id, rol: 'colaborador' }, miembro.id, { permisos: { logistica: 'gestionar' } }), /Solo el propietario/);
    await assert.rejects(servicio.actualizar(u, miembro.id, { permisos: { administrador: 'gestionar' } }), /Permiso inválido/);
    await servicio.actualizar(u, miembro.id, { estado: 'revocado' });
    assert.equal((await servicio.listarTiendas(persona.id)).length, 0);
    const nueva = await servicio.invitar(u, datos);
    assert.equal((await servicio.consultar(nueva.token)).existente, true);
    await assert.rejects(servicio.aceptar(nueva.token, 'OtraPassword123'), /no coincide/);
    await servicio.aceptar(nueva.token, 'PruebaAccesos987');
    await servicio.actualizar(u, miembro.id, { estado: 'revocado' });
    const expirada = await servicio.invitar(u, datos);
    const actual = await Miembro.findByPk(miembro.id);
    await actual.update({ token_expira: new Date(Date.now() - 1000) });
    await assert.rejects(servicio.consultar(expirada.token), /inválida o vencida/);
    console.log('OK: alta directa con contraseña del propietario, hash bcrypt, cuenta activa, correo duplicado sin sobrescritura, reactivación; compatibilidad de invitación, uso único, permisos, aislamiento, revocación y vencimiento.');
  } catch (e) { console.error(e.stack); process.exitCode = 1; }
  finally {
    for (const restore of restaurar.reverse()) restore();
    db.transaction = originalTransaction;
    if (transaction && !transaction.finished) {
      await transaction.rollback();
      console.log('Fixtures revertidos por ROLLBACK.');
    } else if (!transaction) console.log('No se abrió una transacción ni se crearon fixtures.');
    await db.close();
  }
})();
