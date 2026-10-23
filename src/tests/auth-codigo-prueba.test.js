const express = require('express');
const request = require('supertest');
jest.mock('../models', () => ({
  Usuario: { findOne: jest.fn(), create: jest.fn() },
  Inquilino: { findOne: jest.fn() }, Rol: { findOne: jest.fn() }, Permiso: {},
  sequelize: { transaction: jest.fn() },
}));
jest.mock('../services/codigoPrueba.service', () => ({ canjear: jest.fn() }));
jest.mock('../services/suscripcion.service', () => ({ suscripcionPorToken: jest.fn() }));
jest.mock('../services/email.service', () => ({ enviarCodigoVerificacionEmail: jest.fn(async () => ({})) }));
jest.mock('../services/authTracking.service', () => ({ registrarEventoConNotificacion: jest.fn(async () => ({})) }));
const { Usuario, Inquilino, Rol, sequelize } = require('../models');
const Codigos = require('../services/codigoPrueba.service');
const Email = require('../services/email.service');
const app = express();
app.use(express.json());
app.use('/api/auth', require('../routes/auth'));
let transaction;
const body = { nombre: 'Ana Prueba', telefono: '0981123456', email: 'ana@example.test', password: 'ClavePrueba123', codigo_prueba: 'GESI-ABC' };
beforeEach(() => {
  jest.clearAllMocks();
  transaction = { commit: jest.fn(), rollback: jest.fn() };
  sequelize.transaction.mockResolvedValue(transaction);
  Usuario.findOne.mockResolvedValue(null);
  Usuario.create.mockResolvedValue({ id: 42, correo_electronico: body.email });
  Inquilino.findOne.mockResolvedValue({ id: 1 });
  Rol.findOne.mockResolvedValue({ id: 2 });
});
test('el registro pasa el código validado al canje y devuelve la duración real, manteniendo el OTP', async () => {
  Codigos.canjear.mockResolvedValue({ dias: 20, periodo_fin: '2026-11-12T10:00:00Z' });
  const res = await request(app).post('/api/auth/register').send(body).expect(201);
  expect(Codigos.canjear).toHaveBeenCalledWith('GESI-ABC', expect.objectContaining({ id: 42 }), transaction);
  expect(res.body).toMatchObject({ requiere_verificacion: true, prueba: { dias: 20 } });
  expect(transaction.commit).toHaveBeenCalledTimes(1);
  expect(Email.enviarCodigoVerificacionEmail).toHaveBeenCalledTimes(1);
});
test('un código inválido revierte el alta y no envía OTP', async () => {
  Codigos.canjear.mockRejectedValue(Object.assign(new Error('Código vencido'), { status: 400 }));
  const res = await request(app).post('/api/auth/register').send(body).expect(400);
  expect(res.body.message).toBe('Código vencido');
  expect(transaction.rollback).toHaveBeenCalledTimes(1);
  expect(transaction.commit).not.toHaveBeenCalled();
  expect(Email.enviarCodigoVerificacionEmail).not.toHaveBeenCalled();
});
test('el registro sin código conserva el flujo actual', async () => {
  await request(app).post('/api/auth/register').send({ ...body, codigo_prueba: undefined }).expect(201);
  expect(Codigos.canjear).not.toHaveBeenCalled();
  expect(transaction.commit).toHaveBeenCalled();
});
