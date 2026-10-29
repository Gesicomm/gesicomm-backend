jest.mock('../models', () => ({
  CodigoPrueba: { findOne: jest.fn(), findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() },
  Plan: { findOne: jest.fn(), findAll: jest.fn() },
  Suscripcion: { create: jest.fn() },
}));
jest.mock('../services/notificaciones/codigoAcceso.service', () => ({enviarCodigoAcceso:jest.fn()}));
const {enviarCodigoAcceso} = require('../services/notificaciones/codigoAcceso.service');
const { CodigoPrueba, Plan, Suscripcion } = require('../models');
const Service = require('../services/codigoPrueba.service');
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
let codigo, usuario;
beforeEach(() => {
  jest.clearAllMocks();
  enviarCodigoAcceso.mockResolvedValue({emailEnviado:false,correoEstado:'sin-destinatario'});
  codigo = { id: 1, codigo: 'GESI-ABCDEF', dias: 20, plan_id: 3, activo: true, update: jest.fn(async cambios => Object.assign(codigo, cambios)) };
  usuario = { id: 40, nombre: 'Ana', correo_electronico: 'ana@example.test', telefono: '0981123456', update: jest.fn() };
  CodigoPrueba.findOne.mockResolvedValue(codigo);
  Plan.findOne.mockResolvedValue({ id: 3, equivale_plan: 'pago' });
  Suscripcion.create.mockImplementation(async data => ({ id: 8, ...data }));
});

test.each([14, 20])('el código activa exactamente %i días dentro de la transacción de registro', async dias => {
  codigo.dias = dias;
  const resultado = await Service.canjear(' gesi-abcdef ', usuario, transaction);
  const [suscripcion, opciones] = Suscripcion.create.mock.calls[0];
  expect(suscripcion.periodo_fin - suscripcion.periodo_inicio).toBe(dias * 86400000);
  expect(suscripcion).toMatchObject({ usuario_id: 40, plan_id: 3, precio_pagado: 0, estado: 'activa' });
  expect(opciones.transaction).toBe(transaction);
  expect(CodigoPrueba.findOne).toHaveBeenCalledWith({ where: { codigo: 'GESI-ABCDEF' }, transaction, lock: 'UPDATE' });
  expect(codigo.update).toHaveBeenCalledWith(expect.objectContaining({ usado_por: 40, suscripcion_id: 8 }), { transaction });
  expect(resultado.dias).toBe(dias);
  expect(usuario.update).toHaveBeenCalledWith({ plan: 'pago' }, { transaction });
  await expect(Service.canjear('GESI-ABCDEF', usuario, transaction)).rejects.toMatchObject({ status: 400 });
  expect(Suscripcion.create).toHaveBeenCalledTimes(1);
});

test.each([
  null,
  { activo: false },
  { usado_en: new Date() },
  { vence_en: '2000-01-01' },
  { email: 'otra@example.test' },
])('rechaza un código no disponible o de otro destinatario (%j)', async datos => {
  CodigoPrueba.findOne.mockResolvedValue(datos === null ? null : { ...codigo, ...datos });
  await expect(Service.canjear('GESI-ABCDEF', usuario, transaction)).rejects.toMatchObject({ status: 400 });
  expect(Suscripcion.create).not.toHaveBeenCalled();
  expect(usuario.update).not.toHaveBeenCalled();
});

test('un plan desactivado no otorga acceso', async () => {
  Plan.findOne.mockResolvedValue(null);
  await expect(Service.canjear('GESI-ABCDEF', usuario, transaction)).rejects.toMatchObject({ status: 400 });
  expect(Suscripcion.create).not.toHaveBeenCalled();
});

test.each([0, -1, 366, 1.5])('el admin no puede generar una duración inválida (%s)', async dias => {
  await expect(Service.crear({ dias, plan_id: 3 }, 1)).rejects.toMatchObject({ status: 400 });
  expect(CodigoPrueba.create).not.toHaveBeenCalled();
});

test('genera un código con duración y destinatario elegidos por el admin', async () => {
  CodigoPrueba.create.mockImplementation(async data => data);
  const resultado = await Service.crear({ dias: 14, plan_id: 3, email: 'ANA@example.test' }, 9);
  expect(resultado.codigo).toMatch(/^GESI-[A-F0-9]{16}$/);
  expect(resultado).toMatchObject({ dias: 14, creado_por: 9, email: 'ana@example.test', plan_id: 3 });
  expect(enviarCodigoAcceso).toHaveBeenCalledWith(expect.objectContaining({email:'ana@example.test',codigo:resultado.codigo}),expect.anything());
});

test('el fallo de envío conserva el código creado y permite reintentar ese mismo código',async()=>{
  CodigoPrueba.create.mockImplementation(async data=>({id:12,...data}));
  enviarCodigoAcceso.mockResolvedValue({emailEnviado:false,correoEstado:'fallido'});
  const creado=await Service.crear({dias:14,plan_id:3,email:'ana@example.test'},9);
  expect(creado).toMatchObject({id:12,emailEnviado:false,correoEstado:'fallido'});
  CodigoPrueba.findByPk.mockResolvedValue(creado);
  enviarCodigoAcceso.mockResolvedValue({emailEnviado:true,correoEstado:'enviado'});
  expect(await Service.enviarCorreo(12)).toMatchObject({emailEnviado:true});
  expect(CodigoPrueba.create).toHaveBeenCalledTimes(1);
  expect(enviarCodigoAcceso).toHaveBeenLastCalledWith(creado,expect.anything());
});

test.each([{email:null},{email:'ana@example.test',activo:false},{email:'ana@example.test',usado_en:new Date()},{email:'ana@example.test',vence_en:'2000-01-01'}])('no envía un código sin destinatario o no disponible (%j)',async cambios=>{
  CodigoPrueba.findByPk.mockResolvedValue({...codigo,...cambios});
  await expect(Service.enviarCorreo(1)).rejects.toMatchObject({status:400});
  expect(enviarCodigoAcceso).not.toHaveBeenCalled();
});


test.each(['fisico','personal'])('el código conserva el acceso elegido a %s', async ruta => {
  Plan.findOne.mockResolvedValue({id:3,equivale_plan:'pago',acceso_rutas:'elegir'});
  CodigoPrueba.create.mockImplementation(async data => data);
  const creado = await Service.crear({dias:20,plan_id:3,ruta_acceso:ruta},9);
  expect(creado.ruta_acceso).toBe(ruta);
  codigo.ruta_acceso = ruta;
  await Service.canjear(codigo.codigo,usuario,transaction);
  expect(Suscripcion.create).toHaveBeenCalledWith(expect.objectContaining({ruta_acceso:ruta}),expect.anything());
});
test('el admin no puede generar ambas rutas con un código de una ruta',async()=>{
  Plan.findOne.mockResolvedValue({id:3,equivale_plan:'pago',acceso_rutas:'elegir'});
  await expect(Service.crear({dias:20,plan_id:3,ruta_acceso:'ambas'},9)).rejects.toMatchObject({status:400});
  expect(CodigoPrueba.create).not.toHaveBeenCalled();
});
