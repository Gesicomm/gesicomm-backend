'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../models', () => ({
  Deposito: { findOne: jest.fn() },
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
