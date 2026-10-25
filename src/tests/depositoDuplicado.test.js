'use strict';

// Alta de depósito: avisa si ya hay uno con el mismo nombre y dirección en la
// tienda (409 DEPOSITO_DUPLICADO) y lo crea igual si el comercio confirma.
const express = require('express');
const request = require('supertest');

jest.mock('../models', () => ({
  Deposito: { findAll: jest.fn(), create: jest.fn() },
  Envio: {},
  RahaEnvioStock: {},
}));
jest.mock('../services/depositoCourier.service', () => ({}));

const { Deposito } = require('../models');
const depositoController = require('../controllers/depositoController');

const app = express();
app.use(express.json());
app.post('/depositos', (req, res, next) => { req.usuario = { id: 7, tiendaId: 69 }; next(); }, depositoController.crear);

const payload = { nombre: 'Depósito Test E2E', departamento: 'Central', ciudad: 'Luque', direccion: 'Av. Test 123' };

beforeEach(() => {
  jest.clearAllMocks();
  Deposito.findAll.mockResolvedValue([{ id: 4, nombre: 'depósito test e2e', direccion: ' Av.  Test 123 ' }]);
  Deposito.create.mockImplementation(async (d) => ({ id: 99, ...d }));
});

test('frena un depósito igual a otro de la misma tienda', async () => {
  const res = await request(app).post('/depositos').send(payload);
  expect(res.status).toBe(409);
  expect(res.body).toMatchObject({ codigo: 'DEPOSITO_DUPLICADO', deposito_id: 4 });
  expect(Deposito.findAll.mock.calls[0][0].where).toMatchObject({ usuario_id: 7, tienda_id: 69 });
  expect(Deposito.create).not.toHaveBeenCalled();
});

test('lo crea si el comercio confirma', async () => {
  const res = await request(app).post('/depositos').send({ ...payload, confirmar_duplicado: true });
  expect(res.status).toBe(201);
  expect(Deposito.create).toHaveBeenCalled();
});

test('otra dirección no es duplicado', async () => {
  const res = await request(app).post('/depositos').send({ ...payload, direccion: 'Otra calle 456' });
  expect(res.status).toBe(201);
});
