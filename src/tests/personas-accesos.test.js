const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
jest.mock('../utils/logger', () => ({ auditoria: jest.fn() }));
jest.mock('../models', () => ({
  Usuario: { findByPk: jest.fn() }, Tienda: { findByPk: jest.fn() },
  Envio: { findOne: jest.fn() }, Courier: { findOne: jest.fn() },
  MetodoPago: { findOne: jest.fn() },
}));
jest.mock('../models/TiendaMiembro', () => ({ findOne: jest.fn() }));
const { Usuario, Tienda, Envio, Courier, MetodoPago } = require('../models');
const Miembro = require('../models/TiendaMiembro');
const { verificarToken } = require('../middleware/autenticacion');
const { regla } = require('../middleware/accesoColaborador');
let permisos;
const app = express();
app.use(express.json());
app.use(verificarToken);
app.use((req, res) => res.json({ actor: req.usuario.id, propietario: req.comercioId, accesos: req.usuario.accesos }));
app.use((err, req, res, next) => res.status(500).json({ message: 'error' }));
const token = tiendaId => jwt.sign({ id: 100, rol: 'colaborador', tiendaId, tenantId: 1, permisos: ['gestionar_tienda'] }, 'test-access-secret');
const call = (method, path, body = {}, tiendaId = 7) => request(app)[method](path).set('Authorization', `Bearer ${token(tiendaId)}`).send(body);
beforeEach(() => {
  process.env.JWT_SECRET = 'test-access-secret';
  jest.clearAllMocks();
  permisos = { comercial: 'ver' };
  Usuario.findByPk.mockImplementation(async id => id === 100 ? { id, activo: true, email_verificado: true } : { inquilino_id: 1 });
  Tienda.findByPk.mockResolvedValue({ id: 7, usuario_id: 20, nombre: 'Tienda A' });
  Miembro.findOne.mockImplementation(async ({ where }) => where.tienda_id === 7 ? { permisos } : null);
  Envio.findOne.mockResolvedValue({ id: 22, estado: 'Pendiente' });
  Courier.findOne.mockResolvedValue({ id: 4 });
  MetodoPago.findOne.mockResolvedValue({id:5});
});
test('solo ver consulta pedidos por POST conservando la identidad del actor', async () => {
  const res = await call('post', '/api/envios/list', { tienda_id: 99, usuario_id: 999 });
  expect(res.status).toBe(200); expect(res.body.actor).toBe(100); expect(res.body.propietario).toBe(20);
  expect(Miembro.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { usuario_id: 100, tienda_id: 7, estado: 'activo' } }));
});
test.each([
  ['post','/api/envios'], ['put','/api/envios/22/estado'], ['post','/api/envios/22/seguimiento/nota'],
  ['post','/api/productos'], ['post','/api/personas'], ['get','/api/auth/service-token'],
  ['post','/api/liquidaciones/confirmar'], ['get','/api/meta/stores'], ['get','/api/endpoint-nuevo'],
])('solo ver bloquea %s %s', async (method,path) => { expect((await call(method,path)).status).toBe(403); });
test('gestionar comercial puede confirmar pero no despachar ni forzar estado logístico', async () => {
  permisos = { comercial: 'gestionar' };
  expect((await call('put','/api/envios/22/estado',{estado:'Confirmado'})).status).toBe(200);
  expect((await call('put','/api/envios/22/estado',{estado:'Despachado'})).status).toBe(403);
  expect((await call('put','/api/envios/22/estado',{estado_comercial:'Confirmado',estado_logistico:'Entregado'})).status).toBe(403);
  expect((await call('post','/api/envios',{estado_logistico:'Entregado'})).status).toBe(403);
  Envio.findOne.mockResolvedValue({id:22,estado:'Despachado'});
  expect((await call('put','/api/envios/22/estado',{estado:'Cancelado'})).status).toBe(403);
});
test('no asigna couriers ni medios de pago de otra cuenta', async () => {
  permisos={comercial:'gestionar'};
  Courier.findOne.mockResolvedValue(null);
  expect((await call('post','/api/envios',{courier_id:99})).status).toBe(404);
  MetodoPago.findOne.mockResolvedValue(null);
  expect((await call('put','/api/envios/22/estado',{estado:'Confirmado',metodo_pago_id:99})).status).toBe(404);
});
test('logística no concede edición comercial ni acceso a credenciales de couriers', async () => {
  permisos = { logistica:'gestionar' };
  expect((await call('put','/api/envios/22/estado',{estado:'Despachado'})).status).toBe(200);
  expect((await call('put','/api/envios/22/estado',{estado:'Despachado',monto:1})).status).toBe(403);
  expect((await call('get','/api/couriers/4/acceso')).status).toBe(403);
  Courier.findOne.mockResolvedValue(null);
  expect((await call('post','/api/liquidaciones/confirmar',{courier_id:99})).status).toBe(404);
});
test('pedidos de otra tienda quedan fuera del alcance aun con permiso de gestión', async () => {
  permisos = { comercial:'gestionar' }; Envio.findOne.mockResolvedValue(null);
  expect((await call('post','/api/envios/99/seguimiento/nota',{nota:'hola'})).status).toBe(404);
  expect(Envio.findOne).toHaveBeenCalledWith({where:{id:99,tienda_id:7,usuario_id:20}});
  expect((await call('post','/api/envios/list',{},8)).status).toBe(403);
});
test('revocar y reducir permisos afecta al mismo JWT inmediatamente', async () => {
  permisos={comercial:'gestionar'};
  expect((await call('post','/api/envios/22/seguimiento/nota',{nota:'a'})).status).toBe(200);
  permisos={comercial:'ver'};
  expect((await call('post','/api/envios/22/seguimiento/nota',{nota:'a'})).status).toBe(403);
  Miembro.findOne.mockResolvedValue(null);
  expect((await call('post','/api/envios/list')).status).toBe(403);
  expect((await call('get','/api/auth/me')).status).toBe(200);
});
test('sin tienda solo permite recuperar la sesión y elegir una autorizada', async () => {
  expect((await call('post','/api/envios/list',{},null)).status).toBe(403);
  expect((await call('get','/api/tiendas/mias',{},null)).status).toBe(200);
});
test('errores de base de datos fallan cerrados',async()=>{
  Miembro.findOne.mockRejectedValue(new Error('offline'));
  expect((await call('post','/api/envios/list')).status).toBe(500);
});
test.each([
 ['productos','post','/api/productos'],
 ['finanzas','post','/api/costos-gastos'],
 ['ecommerce','put','/api/mis-landings-simples/3'],
 ['negocio','put','/api/mi-tienda'],
 ['configuracion','get','/api/meta/connect'],
])('la membresía vigente controla %s sin reemplazar al actor',async(mod,method,path)=>{
 permisos={[mod]:'gestionar'};
 const res=await call(method,path);
 expect(res.status).toBe(200);
 expect(res.body.actor).toBe(100);expect(res.body.propietario).toBe(20);
 permisos={[mod]:'ver'};
 expect((await call(method,path)).status).toBe(403);
 Miembro.findOne.mockResolvedValue(null);
 expect((await call(method,path)).status).toBe(403);
});
test('dashboard es solo consulta y no concede comercial',()=>{
  const usuario={tiendaId:7,accesos:{dashboard_operativo:'ver'}};
  expect(regla({usuario,method:'POST',originalUrl:'/api/reportes/kpis'})).toBe(true);
  expect(regla({usuario,method:'POST',originalUrl:'/api/envios/list'})).toBe(false);
});
