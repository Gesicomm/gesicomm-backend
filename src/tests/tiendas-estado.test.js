jest.mock('../models', () => ({ Tienda: { findOne: jest.fn(), findAll: jest.fn() } }));
jest.mock('../services/typography.service', () => ({}));
jest.mock('whois-json', () => jest.fn());
jest.mock('../middleware/autenticacion', () => ({
  verificarToken: (req, res, next) => {
    if (!req.headers['x-test-user']) return res.sendStatus(401);
    req.usuario = { id: Number(req.headers['x-test-user']) };
    next();
  },
}));

const express = require('express');
const request = require('supertest');
const { Tienda } = require('../models');
const app = express();
app.use(express.json());
app.use('/tiendas', require('../routes/tiendas'));

beforeEach(() => jest.clearAllMocks());

test.each([false, true])('el dueño puede guardar activo=%s sin borrar datos', async activo => {
  const tienda = { id: 12, activo: !activo, save: jest.fn().mockResolvedValue() };
  Tienda.findOne.mockResolvedValue(tienda);
  const res = await request(app).patch('/tiendas/12/estado').set('x-test-user', '7').send({ activo });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ id: 12, activo });
  expect(Tienda.findOne).toHaveBeenCalledWith({ where: { id: 12, usuario_id: 7 } });
  expect(tienda.save).toHaveBeenCalledTimes(1);
});

test('no permite cambiar tiendas ajenas o inexistentes', async () => {
  Tienda.findOne.mockResolvedValue(null);
  const res = await request(app).patch('/tiendas/12/estado').set('x-test-user', '8').send({ activo: false });
  expect(res.status).toBe(404);
  expect(Tienda.findOne).toHaveBeenCalledWith({ where: { id: 12, usuario_id: 8 } });
});

test.each([{}, { activo: 'false' }, { activo: 0 }, { activo: null }])('rechaza estados inválidos %j', async body => {
  const res = await request(app).patch('/tiendas/12/estado').set('x-test-user', '7').send(body);
  expect(res.status).toBe(400);
  expect(Tienda.findOne).not.toHaveBeenCalled();
});

test('exige autenticación', async () => {
  expect((await request(app).patch('/tiendas/12/estado').send({ activo: false })).status).toBe(401);
  expect(Tienda.findOne).not.toHaveBeenCalled();
});

test.each(['abc', '-1', '1.2'])('rechaza el identificador %s', async id => {
  expect((await request(app).patch(`/tiendas/${id}/estado`).set('x-test-user', '7').send({ activo: false })).status).toBe(400);
});

test('el listado conserva tiendas inactivas para poder reactivarlas', async () => {
  const data = { id: 12, nombre: 'Prueba', activo: false };
  Tienda.findAll.mockResolvedValue([{ toJSON: () => data }]);
  const res = await request(app).get('/tiendas/mias').set('x-test-user', '7');
  expect(res.body).toEqual([data]);
  expect(Tienda.findAll.mock.calls[0][0].attributes).toContain('activo');
});

describe('eliminación definitiva de tiendas vacías', () => {
  let tienda;
  let pedidos;
  let transaction;
  beforeEach(() => {
    transaction = { LOCK: { UPDATE: 'UPDATE' } };
    pedidos = { getAttributes: () => ({ tienda_id: { type: { key: 'INTEGER' } } }), count: jest.fn().mockResolvedValue(0) };
    Tienda.sequelize = {
      transaction: jest.fn((options, callback) => callback(transaction)),
      models: { Tienda, Envio: pedidos },
    };
    tienda = { id: 12, nombre: 'Prueba', activo: false, destroy: jest.fn().mockResolvedValue() };
    Tienda.findOne.mockResolvedValue(tienda);
  });
  const borrar = body => request(app).delete('/tiendas/12').set('x-test-user', '7').send(body);

  test('elimina una tienda vacía dentro de una transacción con bloqueo', async () => {
    const res = await borrar({ nombre: 'Prueba' });
    expect(res.status).toBe(200);
    expect(tienda.destroy).toHaveBeenCalledWith({ transaction });
    expect(Tienda.findOne).toHaveBeenCalledWith({ where: { id: 12, usuario_id: 7 }, transaction, lock: 'UPDATE' });
  });
  test('rechaza tiendas con historial', async () => {
    pedidos.count.mockResolvedValue(1);
    expect((await borrar({ nombre: 'Prueba' })).status).toBe(409);
    expect(tienda.destroy).not.toHaveBeenCalled();
  });
  test('exige inactivar primero', async () => {
    tienda.activo = true;
    expect((await borrar({ nombre: 'Prueba' })).status).toBe(409);
    expect(tienda.destroy).not.toHaveBeenCalled();
  });
  test.each([{}, { nombre: 'Otra' }])('exige el nombre exacto %j', async body => {
    expect((await borrar(body)).status).toBe(400);
    expect(tienda.destroy).not.toHaveBeenCalled();
  });
  test('no elimina tiendas ajenas', async () => {
    Tienda.findOne.mockResolvedValue(null);
    expect((await borrar({ nombre: 'Prueba' })).status).toBe(404);
    expect(tienda.destroy).not.toHaveBeenCalled();
  });
  test('rechaza acceso sin sesión', async () => {
    expect((await request(app).delete('/tiendas/12').send({ nombre: 'Prueba' })).status).toBe(401);
    expect(tienda.destroy).not.toHaveBeenCalled();
  });
  test('respeta relaciones Speedbox por el ID interno', async () => {
    const count = jest.fn().mockResolvedValue(1);
    Tienda.sequelize.models.SpeedboxTienda = { getAttributes: () => ({ gesicom_tienda_id: {}, tienda_id: { type: { key: 'STRING' } } }), count };
    expect((await borrar({ nombre: 'Prueba' })).status).toBe(409);
    expect(count).toHaveBeenCalledWith({ where: { gesicom_tienda_id: 12 }, transaction, paranoid: false });
    expect(tienda.destroy).not.toHaveBeenCalled();
  });
});
