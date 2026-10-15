'use strict';
const express = require('express');
const request = require('supertest');
const { UniqueConstraintError } = require('sequelize');

jest.mock('../../models', () => ({
  sequelize: { transaction: jest.fn() }, Tienda: { findOne: jest.fn() }, Usuario: { findByPk: jest.fn() },
  ImportacionSolicitud: { findOne: jest.fn(), create: jest.fn(), findAndCountAll: jest.fn() }, Notificacion: { bulkCreate: jest.fn() },
}));
jest.mock('../../services/notificaciones/pedidosNotificaciones.service', () => ({ idsDeAdministradores: jest.fn() }));
const { sequelize, Tienda, Usuario, ImportacionSolicitud, Notificacion } = require('../../models');
const { idsDeAdministradores } = require('../../services/notificaciones/pedidosNotificaciones.service');
const controller = require('../../controllers/importadaChinaController');
const tx = { id: 'TX' };
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.usuario = { id: 7, tiendaId: req.headers['x-sin-tienda'] ? null : 9, rol: req.headers['x-rol'] || 'usuario' }; next(); });
app.post('/solicitudes', controller.solicitar);
app.get('/solicitudes', controller.listar);
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
const datos = { producto_url: 'https://www.alibaba.com/product-detail/Test_123.html', cantidad: 100, transporte: 'aereo', observaciones: 'Color azul', clave_idempotencia: '07e20001-1234-4567-8123-123456789abc' };

beforeEach(() => {
  jest.resetAllMocks();
  sequelize.transaction.mockImplementation(callback => callback(tx));
  Usuario.findByPk.mockResolvedValue({ id: 7, nombre: 'María', inquilino_id: 12 });
  Tienda.findOne.mockResolvedValue({ id: 9, nombre: 'Mi tienda' });
  ImportacionSolicitud.findOne.mockResolvedValue(null);
  ImportacionSolicitud.create.mockImplementation(async data => ({ ...data, id: 40, created_at: '2026-10-14T15:00:00Z' }));
  Notificacion.bulkCreate.mockResolvedValue([]);
  idsDeAdministradores.mockResolvedValue([21, 22]);
});

test('guarda la solicitud con cuenta, tienda, fecha y estado antes de confirmar y avisar a los administradores', async () => {
  const res = await request(app).post('/solicitudes').send(datos);
  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ ok: true, solicitud: { id: 40, estado: 'Pendiente de cotización', created_at: '2026-10-14T15:00:00Z' } });
  expect(Tienda.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 9, usuario_id: 7, inquilino_id: 12 } }));
  expect(ImportacionSolicitud.create).toHaveBeenCalledWith(expect.objectContaining({ ...datos, usuario_id: 7, tienda_id: 9, inquilino_id: 12, estado: 'Pendiente de cotización' }), { transaction: tx });
  const [avisos, opciones] = Notificacion.bulkCreate.mock.calls[0];
  expect(opciones).toEqual({ transaction: tx });
  expect(avisos.map(a => a.usuario_id)).toEqual([21, 22]);
  expect(avisos[0]).toMatchObject({ entidad_id: 40, entidad_tipo: 'importada_china_solicitud' });
  expect(avisos[0].mensaje).toContain('100 unidades');
  expect(avisos[0].mensaje).toContain('Transporte aéreo');
  expect(avisos[0].mensaje).toContain('Color azul');
});

test.each(['http://www.alibaba.com/p', 'https://alibaba.com.ejemplo.com/p', 'https://falsoalibaba.com/p', 'https://example.com/p', 'javascript:alert(1)', 'https://usuario:clave@alibaba.com/p', 'https://alibaba.com:8080/p', ''])('rechaza enlaces que no sean HTTPS de Alibaba: %s', async producto_url => {
  expect((await request(app).post('/solicitudes').send({ ...datos, producto_url })).status).toBe(400);
  expect(ImportacionSolicitud.create).not.toHaveBeenCalled();
});

test.each([0, -1, 1.5, '', null, true, 2147483648])('rechaza cantidades inválidas: %j', async cantidad => {
  expect((await request(app).post('/solicitudes').send({ ...datos, cantidad })).status).toBe(400);
});

test('admite subdominios oficiales y opción de transporte predeterminada', async () => {
  const res = await request(app).post('/solicitudes').send({ ...datos, producto_url: 'https://spanish.alibaba.com/product-detail/producto.html#info', transporte: undefined });
  expect(res.status).toBe(201);
  expect(ImportacionSolicitud.create.mock.calls[0][0]).toMatchObject({ producto_url: 'https://spanish.alibaba.com/product-detail/producto.html', transporte: 'conveniente' });
});

test('rechaza transporte desconocido, observaciones excesivas y envíos sin clave de reintento', async () => {
  for (const cambio of [{ transporte: 'tren' }, { observaciones: 'a'.repeat(2001) }, { clave_idempotencia: undefined }]) {
    expect((await request(app).post('/solicitudes').send({ ...datos, ...cambio })).status).toBe(400);
  }
});

test('un reintento no duplica la solicitud ni los avisos', async () => {
  const primero = await request(app).post('/solicitudes').send(datos);
  const guardada = { ...ImportacionSolicitud.create.mock.calls[0][0], ...primero.body.solicitud };
  ImportacionSolicitud.findOne.mockResolvedValue(guardada);
  const segundo = await request(app).post('/solicitudes').send(datos);
  expect(segundo.status).toBe(200);
  expect(segundo.body.duplicada).toBe(true);
  expect(segundo.body.solicitud.id).toBe(primero.body.solicitud.id);
  expect(ImportacionSolicitud.create).toHaveBeenCalledTimes(1);
  expect(Notificacion.bulkCreate).toHaveBeenCalledTimes(1);
  expect((await request(app).post('/solicitudes').send({ ...datos, cantidad: 200 })).status).toBe(409);
});

test('un choque entre dos envíos concurrentes recupera el registro creado por el otro', async () => {
  ImportacionSolicitud.create.mockImplementation(async data => {
    ImportacionSolicitud.findOne.mockResolvedValue({ ...data, id: 41, created_at: new Date() });
    throw new UniqueConstraintError({ message: 'Duplicado' });
  });
  const res = await request(app).post('/solicitudes').send(datos);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ duplicada: true, solicitud: { id: 41 } });
  expect(Notificacion.bulkCreate).not.toHaveBeenCalled();
});

test('no confirma si falla la escritura de solicitud o la recepción interna', async () => {
  ImportacionSolicitud.create.mockRejectedValueOnce(new Error('Error DB'));
  expect((await request(app).post('/solicitudes').send(datos)).status).toBe(500);
  expect(Notificacion.bulkCreate).not.toHaveBeenCalled();
  Notificacion.bulkCreate.mockRejectedValueOnce(new Error('Error al guardar aviso'));
  const res = await request(app).post('/solicitudes').send(datos);
  expect(res.status).toBe(500);
  expect(res.body.ok).toBeUndefined();
});

test('exige la tienda propia y un administrador del mismo inquilino', async () => {
  expect((await request(app).post('/solicitudes').set('x-sin-tienda', '1').send(datos)).status).toBe(409);
  Tienda.findOne.mockResolvedValueOnce(null);
  expect((await request(app).post('/solicitudes').send(datos)).status).toBe(403);
  idsDeAdministradores.mockResolvedValue([]);
  expect((await request(app).post('/solicitudes').send(datos)).status).toBe(409);
  expect(ImportacionSolicitud.create).not.toHaveBeenCalled();
});

test('solo el administrador consulta las solicitudes de su inquilino con paginación', async () => {
  expect((await request(app).get('/solicitudes')).status).toBe(403);
  ImportacionSolicitud.findAndCountAll.mockResolvedValue({ count: 1, rows: [{ id: 40 }] });
  const res = await request(app).get('/solicitudes?page=2').set('x-rol', 'administrador');
  expect(res.status).toBe(200);
  expect(ImportacionSolicitud.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ where: { inquilino_id: 12 }, limit: 50, offset: 50 }));
});
