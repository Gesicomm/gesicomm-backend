'use strict';

jest.mock('../models', () => ({
  Landing: {}, LandingItem: { findAll: jest.fn() },
  Usuario: { findByPk: jest.fn(), update: jest.fn() },
}));
jest.mock('../services/landing.service', () => ({}));
jest.mock('../services/stockPorTienda.service', () => ({}));
jest.mock('../services/landingCodigo.service', () => ({}));
jest.mock('../services/imagen.service', () => ({}));
jest.mock('../services/aiCodeValidator.service', () => ({ detectarBloquesSinConfirmar: jest.fn(() => ['urgencia']) }));
const { Usuario } = require('../models');
const Service = require('../services/landingSimple.service');

describe('Aceptación única de publicación de IA por usuario', () => {
  let landing, usuario;
  beforeEach(() => {
    jest.clearAllMocks();
    usuario = { id: 7, contenido_ia_aceptado_en: null };
    Usuario.findByPk.mockImplementation(async () => ({ ...usuario }));
    Usuario.update.mockImplementation(async datos => { Object.assign(usuario, datos); return [1]; });
    landing = { tipo_pagina: 'contacto', content: {}, save: jest.fn(), toJSON() { return { activo: this.activo }; } };
    jest.spyOn(Service, 'buscarPropia').mockResolvedValue(landing);
  });
  afterEach(() => jest.restoreAllMocks());

  test('bloquea sin aceptación y no la registra implícitamente', async () => {
    await expect(Service.cambiarEstado(1, 3, true, { usuarioId: 7 })).rejects.toThrow('aceptá explícitamente');
    expect(Usuario.update).not.toHaveBeenCalled();
    expect(landing.save).not.toHaveBeenCalled();
  });
  test('recuerda la aceptación al despublicar, republicar y publicar otra tienda', async () => {
    await expect(Service.cambiarEstado(1, 3, true, { usuarioId: 7, aceptarContenidoIA: true })).resolves.toMatchObject({ contenido_ia_aceptado: true });
    expect(usuario.contenido_ia_aceptado_en).toBeInstanceOf(Date);
    await Service.cambiarEstado(1, 3, false, { usuarioId: 7 });
    await expect(Service.cambiarEstado(1, 3, true, { usuarioId: 7 })).resolves.toMatchObject({ activo: true });
    await expect(Service.cambiarEstado(2, 4, true, { usuarioId: 7 })).resolves.toMatchObject({ activo: true });
    expect(Usuario.update).toHaveBeenCalledTimes(1);
    expect(Usuario.update.mock.calls[0][1].where).toEqual({ id: 7, contenido_ia_aceptado_en: null });
  });
  test('despublicar nunca registra una aceptación', async () => {
    await Service.cambiarEstado(1, 3, false, { usuarioId: 7, aceptarContenidoIA: true });
    expect(Usuario.update).not.toHaveBeenCalled();
  });
  test('la aceptación de una cuenta no se aplica a otra', async () => {
    usuario.contenido_ia_aceptado_en = new Date();
    await Service.cambiarEstado(1, 3, true, { usuarioId: 7 });
    Usuario.findByPk.mockResolvedValue({ id: 8, contenido_ia_aceptado_en: null });
    await expect(Service.cambiarEstado(2, 4, true, { usuarioId: 8 })).rejects.toThrow('aceptá explícitamente');
  });
  test('no publica si falla el guardado de la aceptación', async () => {
    Usuario.update.mockRejectedValueOnce(new Error('Sin conexión'));
    await expect(Service.cambiarEstado(1, 3, true, { usuarioId: 7, aceptarContenidoIA: true })).rejects.toThrow('Sin conexión');
    expect(landing.save).not.toHaveBeenCalled();
  });
});
