'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../models', () => ({
  Deposito: { findOne: jest.fn(), findAndCountAll: jest.fn() },
  Envio: { count: jest.fn() },
}));

jest.mock('../services/depositoCourier.service', () => ({
  listarPorDeposito: jest.fn(),
  reemplazar: jest.fn(),
}));

const { Deposito } = require('../models');
const depositoController = require('../controllers/depositoController');

function appConUsuario() {
  const app = express();
  app.use(express.json());
  app.put('/depositos/:id', (req, res, next) => {
    req.usuario = { id: 7 };
    next();
  }, depositoController.editar);
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('depositoController.editar', () => {
  beforeEach(() => jest.clearAllMocks());

  test('guarda campos opcionales enviados en snake_case desde el frontend', async () => {
    const deposito = {
      id: 10,
      usuario_id: 7,
      nombre: 'Depósito Test E2E',
      departamento: null,
      ciudad: 'Luque',
      direccion: 'Av. Test 123',
      referencia: null,
      persona_contacto: 'Martín',
      telefono_contacto: '0981000000',
      google_maps_url: 'https://maps.app.goo.gl/anterior',
      toJSON() {
        return { ...this, update: undefined, toJSON: undefined };
      },
      update: jest.fn(async function update(datos) {
        Object.assign(this, datos);
        return this;
      }),
    };
    Deposito.findOne.mockResolvedValue(deposito);

    const res = await request(appConUsuario())
      .put('/depositos/10')
      .send({
        nombre: 'Depósito Test E2E',
        departamento: '',
        ciudad: 'Luque',
        direccion: 'Av. Test 123',
        referencia: '',
        persona_contacto: 'Martin',
        telefono_contacto: '0972400760',
        google_maps_url: 'https://maps.app.goo.gl/gHEz7gWbNKCGaRWt8',
      });

    expect(res.status).toBe(200);
    expect(deposito.update).toHaveBeenCalledWith(expect.objectContaining({
      persona_contacto: 'Martin',
      telefono_contacto: '0972400760',
      google_maps_url: 'https://maps.app.goo.gl/gHEz7gWbNKCGaRWt8',
    }));
    expect(res.body.telefono_contacto).toBe('0972400760');
  });
});

// Depósitos y salones son de UNA tienda. El filtro tiene que ser
// "de la cuenta Y de la tienda activa": con un OR entre las dos, cada tienda
// veía los depósitos de las demás tiendas de la misma cuenta.
describe('depositoController: aislamiento por tienda', () => {
  beforeEach(() => jest.clearAllMocks());

  function appConTienda(usuario) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.usuario = usuario; next(); });
    app.post('/depositos/listado', depositoController.listar);
    app.get('/depositos/:id', depositoController.obtenerPorId);
    app.put('/depositos/:id', depositoController.editar);
    app.patch('/depositos/:id/estado', depositoController.cambiarEstado);
    app.delete('/depositos/:id', depositoController.eliminar);
    return app;
  }

  test('listar acota a la cuenta y a la tienda activa', async () => {
    Deposito.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

    await request(appConTienda({ id: 7, tiendaId: 3 })).post('/depositos/listado').send({ activo: true, limit: 100 });

    expect(Deposito.findAndCountAll.mock.calls[0][0].where).toEqual({ usuario_id: 7, tienda_id: 3, activo: true });
  });

  test('buscar no reemplaza el filtro de cuenta ni el de tienda', async () => {
    Deposito.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

    await request(appConTienda({ id: 7, tiendaId: 3 })).post('/depositos/listado').send({ buscar: 'centro' });

    const { where } = Deposito.findAndCountAll.mock.calls[0][0];
    expect(where.usuario_id).toBe(7);
    expect(where.tienda_id).toBe(3);
  });

  test('sin tienda activa (cuenta sin tiendas) sigue acotando a la cuenta', async () => {
    Deposito.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

    await request(appConTienda({ id: 7, tiendaId: null })).post('/depositos/listado').send({});

    expect(Deposito.findAndCountAll.mock.calls[0][0].where).toEqual({ usuario_id: 7 });
  });

  test.each([
    ['ver', (app) => request(app).get('/depositos/10')],
    ['editar', (app) => request(app).put('/depositos/10').send({ nombre: 'x' })],
    ['cambiar estado', (app) => request(app).patch('/depositos/10/estado').send({ activo: false })],
    ['eliminar', (app) => request(app).delete('/depositos/10')],
  ])('%s busca el depósito dentro de la tienda activa', async (_nombre, pedir) => {
    Deposito.findOne.mockResolvedValue(null);

    const res = await pedir(appConTienda({ id: 7, tiendaId: 3 }));

    expect(res.status).toBe(404);
    expect(Deposito.findOne.mock.calls[0][0].where).toEqual({ id: '10', usuario_id: 7, tienda_id: 3 });
  });
});
