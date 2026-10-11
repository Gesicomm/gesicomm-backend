'use strict';

/**
 * Aislamiento de pedidos por tienda.
 *
 * Los filtros de pedidos agregan `tienda_id` solo cuando la sesión trae
 * tienda activa. Una cuenta con 2+ tiendas recién logueada tiene ese claim
 * en null hasta que elige, y en esa ventana la API devolvía los pedidos de
 * todas sus tiendas mezclados (auditoría del 2026-10-11). Además, las
 * acciones de seguimiento por WhatsApp sobre un pedido puntual filtraban
 * solo por cuenta, no por tienda.
 *
 * No toca la base: los modelos se mockean. La de localhost:5434 es
 * PRODUCCIÓN detrás de un túnel.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../models', () => ({
  sequelize: { transaction: (cb) => cb('TX') },
  Tienda: { findAll: jest.fn() },
  Envio: { findOne: jest.fn() },
  SeguimientoContacto: { findAll: jest.fn() },
}));
jest.mock('../utils/historial', () => ({ registrarHistorial: jest.fn(async () => undefined) }));
jest.mock('../services/queue/seguimientoQueue', () => ({ encolarRecordatorio: jest.fn(async () => undefined) }));

const { Tienda, Envio, SeguimientoContacto } = require('../models');
const { exigirTiendaActiva } = require('../middleware/resolverTiendaActiva');
const seguimiento = require('../controllers/envioSeguimientoController');

/** Router mínimo: sesión fabricada, el guard, y un handler que devuelve con qué tienda quedó. */
function appCon(usuario) {
  const app = express();
  app.use((req, res, next) => { req.usuario = { ...usuario }; next(); });
  app.use(exigirTiendaActiva);
  app.get('/pedidos', (req, res) => res.json({ tiendaId: req.usuario.tiendaId ?? null }));
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('exigirTiendaActiva', () => {
  test('cuenta con 2 tiendas y ninguna elegida: 409, no se llega a los pedidos', async () => {
    Tienda.findAll.mockResolvedValue([{ id: 3 }, { id: 9 }]);

    const res = await request(appCon({ id: 7, rol: 'usuario', tiendaId: null })).get('/pedidos');

    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('TIENDA_NO_SELECCIONADA');
    expect(Tienda.findAll.mock.calls[0][0].where).toEqual({ usuario_id: 7 });
  });

  test('con tienda activa pasa sin consultar nada', async () => {
    const res = await request(appCon({ id: 7, rol: 'usuario', tiendaId: 9 })).get('/pedidos');

    expect(res.status).toBe(200);
    expect(res.body.tiendaId).toBe(9);
    expect(Tienda.findAll).not.toHaveBeenCalled();
  });

  test('una sola tienda: se resuelve al vuelo', async () => {
    Tienda.findAll.mockResolvedValue([{ id: 3 }]);

    const res = await request(appCon({ id: 7, rol: 'usuario', tiendaId: null })).get('/pedidos');

    expect(res.status).toBe(200);
    expect(res.body.tiendaId).toBe(3);
  });

  test('cuenta sin tiendas y administrador: pasan', async () => {
    Tienda.findAll.mockResolvedValue([]);
    const sinTienda = await request(appCon({ id: 7, rol: 'usuario', tiendaId: null })).get('/pedidos');
    expect(sinTienda.status).toBe(200);

    const admin = await request(appCon({ id: 1, rol: 'administrador', tiendaId: null })).get('/pedidos');
    expect(admin.status).toBe(200);
    expect(Tienda.findAll).toHaveBeenCalledTimes(1); // solo la de la cuenta sin tiendas
  });

  test('si no se puede consultar las tiendas, corta (no falla abierto)', async () => {
    Tienda.findAll.mockRejectedValue(new Error('read ECONNRESET'));

    const res = await request(appCon({ id: 7, rol: 'usuario', tiendaId: null })).get('/pedidos');

    expect(res.status).toBe(500);
  });
});

describe('seguimiento por WhatsApp de un pedido puntual', () => {
  function respuesta() {
    const res = { codigo: 200 };
    res.status = jest.fn((c) => { res.codigo = c; return res; });
    res.json = jest.fn(() => res);
    return res;
  }

  test('busca el pedido dentro de la tienda activa, no solo de la cuenta', async () => {
    Envio.findOne.mockResolvedValue(null); // el pedido es de la otra tienda
    const res = respuesta();

    await seguimiento.listarContactos(
      { usuario: { id: 7, rol: 'usuario', tiendaId: 9 }, params: { id: '50' }, body: {} }, res, jest.fn(),
    );

    expect(Envio.findOne.mock.calls[0][0].where).toEqual({ id: '50', usuario_id: 7, tienda_id: 9 });
    expect(res.codigo).toBe(404);
    expect(SeguimientoContacto.findAll).not.toHaveBeenCalled();
  });

  test('el administrador sigue sin filtro de cuenta ni de tienda', async () => {
    Envio.findOne.mockResolvedValue(null);

    await seguimiento.listarContactos(
      { usuario: { id: 1, rol: 'administrador', tiendaId: 9 }, params: { id: '50' }, body: {} }, respuesta(), jest.fn(),
    );

    expect(Envio.findOne.mock.calls[0][0].where).toEqual({ id: '50' });
  });
});
