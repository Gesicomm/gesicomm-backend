'use strict';
const { createClient } = require('../services/marcaPersonal.client');
const userId = '0d5c3fcf-05e1-4f5a-a889-222222222222';
const managed = { id:userId, email:'gesicom-41@sso.gesicomm.com', app_metadata:{gesicom_source:'gesicomm-production',gesicom_user_id:'41'} };
const config = {url:'https://project.supabase.co',key:'server-secret'};
test('los enlaces sólo se pueden editar con membresía y permisos vigentes en esa marca',async()=>{
 const link={supabase_user_id:userId,account_id:'marca-a'};
 const fetchImpl=stub([[link],[{account_id:'marca-a'}],[{id:'marca-a'}],[{role:'content',module_access:['crm']}]]);
 expect(await createClient({...config,fetchImpl}).accountAccess(41,'marca-a')).toBe(true);
 const denied=stub([[link],[],[{id:'marca-b'}],[{role:'content',module_access:['crm']}]]);
 expect(await createClient({...config,fetchImpl:denied}).accountAccess(41,'marca-b')).toBe(false);
});
function stub(responses) {
  return jest.fn(async () => {
    const value = responses.shift();
    return { ok: value?.status ? value.status < 400 : true, status:value?.status||200,
      json:async()=>value?.body === undefined ? value : value.body };
  });
}
test('crea una identidad propia, nunca usa el correo real para apropiarse de cuentas existentes', async () => {
  const fetchImpl = stub([[],null,managed,managed,{supabase_user_id:userId,account_id:'account',enabled:true}]);
  const result = await createClient({...config,fetchImpl}).provision({id:41,nombre:'Prueba',email:'real@example.test',enabled:true});
  expect(result.enabled).toBe(true);
  const body = JSON.parse(fetchImpl.mock.calls[2][1].body);
  expect(body.email).toBe('gesicom-41@sso.gesicomm.com');
  expect(body.password.length).toBeGreaterThan(40);
  expect(body.app_metadata.gesicom_user_id).toBe('41');
  const provision = JSON.parse(fetchImpl.mock.calls[4][1].body);
  expect(provision.p_email).toBe('real@example.test');
  expect(provision.p_supabase_user_id).toBe(userId);
});
test('un reintento usa la vinculación existente, sin crear otro usuario', async () => {
  const fetchImpl = stub([[{supabase_user_id:userId}],managed,{enabled:true}]);
  await createClient({...config,fetchImpl}).provision({id:41,nombre:'Prueba',email:'real@example.test',enabled:true});
  expect(fetchImpl).toHaveBeenCalledTimes(3);
  expect(fetchImpl.mock.calls.some(([url,options])=>url.endsWith('/admin/users')&&options.method==='POST')).toBe(false);
});
test('rechaza una vinculación que apunta a un usuario original de T2E', async () => {
  const fetchImpl = stub([[{supabase_user_id:userId}],{...managed,app_metadata:{}}]);
  await expect(createClient({...config,fetchImpl}).provision({id:41,nombre:'Prueba'})).rejects.toMatchObject({status:409});
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
test('una falla externa no filtra claves ni cuerpos sensibles al usuario', async () => {
  const fetchImpl = stub([{status:500,body:{message:'password=secret service_role=secret'}}]);
  await expect(createClient({...config,fetchImpl}).getLink(41)).rejects.toThrow('Marca Personal no pudo completar la operación.');
});
test('verifica el enlace en el servidor y sólo entrega una sesión de la identidad esperada', async () => {
  const fetchImpl = stub([managed,{hashed_token:'hash-private'},{user:{id:userId},access_token:'access',refresh_token:'refresh'}]);
  const session = await createClient({...config,fetchImpl}).session(41,userId);
  expect(session).toEqual({access_token:'access',refresh_token:'refresh'});
  expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({type:'magiclink',email:managed.email});
});
test('rechaza una sesión de otro usuario', async () => {
  const fetchImpl = stub([managed,{hashed_token:'hash-private'},{user:{id:'other'},access_token:'access',refresh_token:'refresh'}]);
  await expect(createClient({...config,fetchImpl}).session(41,userId)).rejects.toThrow('No se pudo iniciar la sesión');
});

jest.mock('../models',()=>({Usuario:{findByPk:jest.fn()},Rol:{}}));
jest.mock('../services/suscripcion.service',()=>({suscripcionActivaDeUsuario:jest.fn()}));
const {Usuario} = require('../models');
const subscriptions = require('../services/suscripcion.service');
const service = require('../services/marcaPersonal.service');

test('la validación para reutilizar sesión informa sólo la identidad y marca vinculadas',async()=>{
 const names=['MARCA_PERSONAL_SSO_ENABLED','MARCA_PERSONAL_SUPABASE_URL','MARCA_PERSONAL_SUPABASE_SERVICE_ROLE_KEY'];
 const previous=names.map(name=>process.env[name]);
 const network=jest.spyOn(global,'fetch').mockResolvedValue({ok:true,json:async()=>[{supabase_user_id:userId,account_id:'marca-a'}]});
 process.env.MARCA_PERSONAL_SSO_ENABLED='true';process.env.MARCA_PERSONAL_SUPABASE_URL=config.url;process.env.MARCA_PERSONAL_SUPABASE_SERVICE_ROLE_KEY=config.key;
 Usuario.findByPk.mockResolvedValue({id:41,nombre:'Prueba',activo:true,email_verificado:true,Rol:{nombre:'administrador'}});subscriptions.suscripcionActivaDeUsuario.mockResolvedValue(null);
 try{const result=await jest.requireActual('../services/marcaPersonal.service').status(41);expect(result).toEqual({user_id:userId,account_id:'marca-a'});expect(network).toHaveBeenCalledTimes(1);expect(network.mock.calls[0][1].method).toBe('GET');}
 finally{network.mockRestore();names.forEach((name,i)=>{if(previous[i]===undefined)delete process.env[name];else process.env[name]=previous[i];});}
});
test.each([
  [true,true,'usuario','pago',true],
  [true,true,'usuario',null,false],
  [true,false,'usuario','pago',false],
  [false,true,'administrador','pago',false],
  [true,true,'administrador',null,true],
])('valida activo=%s, verificado=%s, rol=%s y plan=%s',async(activo,email_verificado,rol,plan,enabled)=>{
  Usuario.findByPk.mockResolvedValue({id:41,nombre:'Prueba',correo_electronico:'real@example.test',activo,email_verificado,Rol:{nombre:rol}});
  subscriptions.suscripcionActivaDeUsuario.mockResolvedValue(plan?{estado:'activa',Plan:{equivale_plan:plan,acceso_rutas:'ambas'},ruta_acceso:'ambas'}:null);
  expect((await service.identity(41)).enabled).toBe(enabled);
});

jest.mock('../services/marcaPersonal.service',()=>{
  const real=jest.requireActual('../services/marcaPersonal.service');
  return {...real,openSession:jest.fn(),status:jest.fn()};
});
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = express(); app.use(cookieParser()); app.use('/sso',require('../routes/marcaPersonalSso'));
const origin='https://automation.gesicomm.com';
test('el intercambio requiere una sesión Gesicom válida',async()=>{
  const response=await request(app).post('/sso/session').set('Origin',origin);
  expect(response.status).toBe(401); expect(service.openSession).not.toHaveBeenCalled();
});
test('un sitio ajeno no puede iniciar el intercambio',async()=>{
  expect((await request(app).post('/sso/session').set('Origin','https://other.test')).status).toBe(403);
});
test('usa la identidad firmada, ignora un usuario enviado en el body y evita cachear tokens',async()=>{
  process.env.JWT_SECRET='test-only';
  service.openSession.mockResolvedValue({user_id:userId,session:{access_token:'access',refresh_token:'refresh'}});
  const token=jwt.sign({id:41,rol:'usuario'},process.env.JWT_SECRET,{expiresIn:'1m'});
  const response=await request(app).post('/sso/session').set('Origin',origin).set('Cookie','accessToken='+token).send({user_id:99});
  expect(response.status).toBe(200); expect(service.openSession).toHaveBeenCalledWith(41);
  expect(response.headers['cache-control']).toContain('no-store');
});


test.each([['fisico',false],['personal',true],['ambas',true]])('Marca Personal exige la ruta %s: habilitado=%s',async(ruta,enabled)=>{
 Usuario.findByPk.mockResolvedValue({id:41,nombre:'Prueba',activo:true,email_verificado:true,Rol:{nombre:'usuario'}});
 subscriptions.suscripcionActivaDeUsuario.mockResolvedValue({estado:'activa',ruta_acceso:ruta,Plan:{equivale_plan:'pago',acceso_rutas:ruta}});
 expect((await service.identity(41)).enabled).toBe(enabled);
});
