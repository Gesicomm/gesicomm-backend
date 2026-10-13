'use strict';
const service = require('../services/raha/service');
const { RahaPortalUsuario, RahaSolicitud } = require('../models');

describe('RAHA Portal & User Management', () => {
  const actorAdmin = { id: 1, rol: 'administrador' };
  const actorUser = { id: 2, rol: 'usuario' };

  test('only admins can create portal users and password must be >= 10 chars', async () => {
    // Non-admin rejected
    await expect(
      service.createPortalUser(actorUser, {
        nombre: 'Operador Raha',
        email: 'test@raha.com',
        password: 'ValidPassword123!',
      })
    ).rejects.toThrow('Solo administradores.');

    // Short password rejected
    await expect(
      service.createPortalUser(actorAdmin, {
        nombre: 'Operador Raha',
        email: 'test@raha.com',
        password: '123',
      })
    ).rejects.toThrow('al menos 10 caracteres');
  });

  test('portalLogin rejects invalid credentials and handles non-existent users safely', async () => {
    await expect(
      service.portalLogin({ email: 'noexiste@raha.com', password: 'Password12345!' })
    ).rejects.toThrow('Credenciales invalidas.');

    await expect(
      service.portalLogin({ email: '', password: '' })
    ).rejects.toThrow('Email y contrasena son obligatorios.');
  });

  test('portalList supports structured pagination and date filters', async () => {
    const resHoy = await service.portalList({ rango_fecha: 'hoy', page: 1, limit: 10 });
    expect(resHoy).toHaveProperty('total');
    expect(resHoy).toHaveProperty('page', 1);
    expect(resHoy).toHaveProperty('limit', 10);
    expect(resHoy).toHaveProperty('totalPaginas');
    expect(resHoy).toHaveProperty('resumen');
    expect(resHoy).toHaveProperty('solicitudes');
    expect(resHoy.rango).toEqual(expect.objectContaining({ rango_fecha: 'hoy' }));

    const resAyer = await service.portalList({ rango_fecha: 'ayer' });
    expect(resAyer.rango).toEqual(expect.objectContaining({ rango_fecha: 'ayer' }));

    const resCustom = await service.portalList({ fecha_desde: '2026-10-10', fecha_hasta: '2026-10-13' });
    expect(resCustom.rango).toEqual({ fecha_desde: '2026-10-10', fecha_hasta: '2026-10-13', rango_fecha: 'custom' });
  });
});
