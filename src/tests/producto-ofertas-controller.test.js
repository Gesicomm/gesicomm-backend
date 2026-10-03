'use strict';
jest.mock('../models', () => ({ sequelize: { transaction: jest.fn() }, Producto: {} }));
jest.mock('../services/producto.service', () => ({ crear: jest.fn(), sincronizarFaq: jest.fn() }));
jest.mock('../services/productoVariante.service', () => ({}));
jest.mock('../services/productoOpcion.service', () => ({}));
jest.mock('../services/imagen.service', () => ({}));
jest.mock('../services/oferta.service', () => ({ crearBorradores: jest.fn() }));

const { sequelize } = require('../models');
const ProductoService = require('../services/producto.service');
const OfertaService = require('../services/oferta.service');
const { crear } = require('../controllers/producto.controller');

describe('Alta conjunta del producto y sus ofertas', () => {
  let req, res, t;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    t = { commit: jest.fn(), rollback: jest.fn() };
    sequelize.transaction.mockResolvedValue(t);
    ProductoService.crear.mockResolvedValue({ id: 42, nombre: 'Producto' });
    OfertaService.crearBorradores.mockResolvedValue([{ id: 61 }]);
    req = { usuario: { tenantId: 1, id: 9, rol: 'tienda' }, body: { nombre: 'Producto', ofertas: [{ nombre: 'Pack' }] } };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  });
  afterEach(() => jest.restoreAllMocks());
  test('persiste ambas cosas en la misma transacción y devuelve IDs para las fotos', async () => {
    await crear(req, res);
    expect(OfertaService.crearBorradores).toHaveBeenCalledWith(42, req.body.ofertas, 1, t);
    expect(t.commit).toHaveBeenCalledTimes(1);
    expect(t.rollback).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 42, nombre: 'Producto', ofertas: [{ id: 61 }] });
  });
  test('revierte todo si una oferta falla y señala la sección Venta', async () => {
    OfertaService.crearBorradores.mockRejectedValue(Object.assign(new Error('Oferta inválida.'), { seccion: 'venta' }));
    await crear(req, res);
    expect(t.rollback).toHaveBeenCalledTimes(1);
    expect(t.commit).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Oferta inválida.', seccion: 'venta' }));
  });
  test('mantiene la respuesta anterior para altas sin ofertas', async () => {
    delete req.body.ofertas;
    await crear(req, res);
    expect(OfertaService.crearBorradores).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ id: 42, nombre: 'Producto' });
  });
});
