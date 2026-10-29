jest.mock('../models', () => ({}));
jest.mock('../services/codigoPrueba.service', () => ({ listar: jest.fn(), crear: jest.fn(), desactivar: jest.fn(), enviarCorreo:jest.fn() }));
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const Codigos = require('../services/codigoPrueba.service');
process.env.JWT_SECRET = 'prueba-local-secret';
const app = express();
app.use(express.json());
app.use('/api/publico', require('../routes/publico'));
app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
const token = rol => `Bearer ${jwt.sign({ id: 8, rol }, process.env.JWT_SECRET)}`;

beforeEach(() => { jest.clearAllMocks(); Codigos.crear.mockResolvedValue({ id: 4, dias: 20, codigo: 'GESI-ABC' }); });
test('el generador exige sesión de administrador', async () => {
  await request(app).get('/api/publico/admin/codigos-prueba').expect(401);
  await request(app).get('/api/publico/admin/codigos-prueba').set('Authorization', token('usuario')).expect(403);
  await request(app).post('/api/publico/admin/codigos-prueba').set('Authorization', token('usuario')).send({ dias: 20, plan_id: 3 }).expect(403);
  expect(Codigos.listar).not.toHaveBeenCalled();
  expect(Codigos.crear).not.toHaveBeenCalled();
});
test('el admin genera los días elegidos y la validación rechaza fracciones', async () => {
  const res = await request(app).post('/api/publico/admin/codigos-prueba').set('Authorization', token('administrador')).send({ dias: 20, plan_id: 3 }).expect(201);
  expect(res.body.dias).toBe(20);
  expect(Codigos.crear).toHaveBeenCalledWith({ dias: 20, plan_id: 3 }, 8);
  await request(app).post('/api/publico/admin/codigos-prueba').set('Authorization', token('administrador')).send({ dias: 1.5, plan_id: 3 }).expect(400);
  expect(Codigos.crear).toHaveBeenCalledTimes(1);
});

test('solo admin puede enviar el correo de un código existente y exige un ID entero',async()=>{
  Codigos.enviarCorreo.mockResolvedValue({emailEnviado:true});
  await request(app).post('/api/publico/admin/codigos-prueba/4/enviar-correo').expect(401);
  await request(app).post('/api/publico/admin/codigos-prueba/4/enviar-correo').set('Authorization',token('usuario')).expect(403);
  await request(app).post('/api/publico/admin/codigos-prueba/abc/enviar-correo').set('Authorization',token('administrador')).expect(400);
  const res=await request(app).post('/api/publico/admin/codigos-prueba/4/enviar-correo').set('Authorization',token('administrador')).expect(200);
  expect(res.body.emailEnviado).toBe(true);
  expect(Codigos.enviarCorreo).toHaveBeenCalledTimes(1);
  expect(Codigos.enviarCorreo).toHaveBeenCalledWith(4);
});
