jest.mock('../services/raha/service', () => ({ portalVerify: jest.fn() }));
jest.mock('../services/raha/dossier', () => ({ enviarExpediente: jest.fn() }));
jest.mock('../services/raha/operaciones', () => ({
  abastecimientos: jest.fn(), destinos: jest.fn(), guardarDestino: jest.fn(), listarEnvios: jest.fn(), resolverEnvio: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const servicio = require('../services/raha/service');
const operaciones = require('../services/raha/operaciones');
const router = require('../routes/rahaPortal');
const app = express();
app.use(express.json());
app.use('/api/raha-portal', router);
app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));

beforeEach(() => {
  jest.clearAllMocks();
  servicio.portalVerify.mockImplementation(async token => {
    if (token !== 'portal-valido') throw Object.assign(new Error('Sesión inválida'), { status: 401 });
    return { id: 5, nombre: 'Operador RAHA' };
  });
  operaciones.abastecimientos.mockResolvedValue({ registros: [] });
  operaciones.guardarDestino.mockResolvedValue({ id: 2 });
  operaciones.resolverEnvio.mockResolvedValue({ id: 15, estado: 'aceptada' });
});

test('las operaciones no aceptan cookies Gesicom ni tokens inválidos como sesión RAHA', async () => {
  await request(app).post('/api/raha-portal/operaciones/abastecimientos').set('Cookie', 'accessToken=cookie').send({}).expect(401);
  await request(app).post('/api/raha-portal/operaciones/abastecimientos').set('Authorization', 'Bearer token-gesicom').send({}).expect(401);
  expect(operaciones.abastecimientos).not.toHaveBeenCalled();
});

test('la resolución recibe el operador autenticado y exige identificadores válidos', async () => {
  const payload = { estado: 'aceptada', version: 0, comentario: 'Coordinar' };
  await request(app).post('/api/raha-portal/operaciones/envios/15/resolver').set('Authorization', 'Bearer portal-valido').send(payload).expect(200);
  expect(operaciones.resolverEnvio).toHaveBeenCalledWith({ id: 5, nombre: 'Operador RAHA' }, 15, payload, true);
  await request(app).post('/api/raha-portal/operaciones/envios/no-es-id/resolver').set('Authorization', 'Bearer portal-valido').send(payload).expect(400);
  expect(operaciones.resolverEnvio).toHaveBeenCalledTimes(1);
});

test('configurar destinos requiere sesión propia y usa al operador autenticado', async () => {
  const destino = { nombre: 'Centro RAHA', ciudad: 'Luque', direccion: 'Calle 1' };
  await request(app).post('/api/raha-portal/operaciones/destinos').send(destino).expect(401);
  await request(app).post('/api/raha-portal/operaciones/destinos').set('Authorization', 'Bearer portal-valido').send(destino).expect(200);
  expect(operaciones.guardarDestino).toHaveBeenCalledWith({ id: 5, nombre: 'Operador RAHA' }, destino);
});
