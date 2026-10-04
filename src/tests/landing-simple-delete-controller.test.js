'use strict';

jest.mock('../models', () => ({ Tienda: { findOne: jest.fn() } }));
jest.mock('../services/landingSimple.service', () => ({ eliminar: jest.fn() }));
jest.mock('../services/imagen.service', () => ({}));
jest.mock('../services/authTracking.service', () => ({}));

const { Tienda } = require('../models');
const LandingSimpleService = require('../services/landingSimple.service');
const { eliminar } = require('../controllers/landingSimple.controller');
const { R2StorageError } = require('../services/r2/r2.errors');

describe('DELETE landing simple: respuesta HTTP', () => {
  let req;
  let res;
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    Tienda.findOne.mockResolvedValue({ id: 7 });
    req = { params: { id: '193' }, usuario: { id: 3 } };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  });
  afterEach(() => jest.restoreAllMocks());

  test('devuelve 503 y un mensaje seguro ante almacenamiento inaccesible', async () => {
    LandingSimpleService.eliminar.mockRejectedValue(new R2StorageError(
      'El servidor no tiene permiso para conectarse al almacenamiento.',
      { status: 503, code: 'EACCES', key: 'private-key', operation: 'DeleteObject' },
    ));
    await eliminar(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      message: 'El servidor no tiene permiso para conectarse al almacenamiento.', errores: undefined,
    });
  });

  test.each([
    [new Error('Landing no encontrada.'), 404],
    [Object.assign(new Error('Validación fallida.'), { errores: ['campo'] }), 422],
    [new Error('Solicitud inválida.'), 400],
    [Object.assign(new Error('Solicitud inválida.'), { status: 200 }), 400],
  ])('conserva el estado HTTP para %s', async (error, status) => {
    LandingSimpleService.eliminar.mockRejectedValue(error);
    await eliminar(req, res);
    expect(res.status).toHaveBeenCalledWith(status);
  });

  test('elimina únicamente en la tienda propia y confirma éxito', async () => {
    await eliminar(req, res);
    expect(Tienda.findOne).toHaveBeenCalledWith({ where: { usuario_id: 3 } });
    expect(LandingSimpleService.eliminar).toHaveBeenCalledWith('193', 7);
    expect(res.json).toHaveBeenCalledWith({ message: 'Landing eliminada.' });
  });

  test('sin tienda propia no intenta eliminar', async () => {
    Tienda.findOne.mockResolvedValue(null);
    await eliminar(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(LandingSimpleService.eliminar).not.toHaveBeenCalled();
  });
});
