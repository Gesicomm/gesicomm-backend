const express = require('express');
const request = require('supertest');

let mockUsuarioActual = null;

jest.mock('../middleware/autenticacion', () => ({
  verificarToken: (req, res, next) => {
    if (!mockUsuarioActual) return res.status(401).json({ message: 'No autenticado.' });
    req.usuario = mockUsuarioActual;
    next();
  },
}));

jest.mock('../services/authTracking.service', () => ({
  resumen: jest.fn(async () => ({ usuarios_total: 3, sesiones_activas: 1 })),
  listarEventos: jest.fn(async () => []),
  listarSesionesActivas: jest.fn(async () => []),
  listarNotificaciones: jest.fn(async () => []),
  marcarNotificacionesLeidas: jest.fn(async () => ({ actualizadas: 2 })),
}));

const AuthTracking = require('../services/authTracking.service');
const adminAuthTrackingRoutes = require('../routes/adminAuthTracking');

function appDePrueba() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/auth-tracking', adminAuthTrackingRoutes);
  return app;
}

beforeEach(() => {
  mockUsuarioActual = null;
  jest.clearAllMocks();
});

describe('admin auth tracking', () => {
  test('sin sesión responde 401', async () => {
    await request(appDePrueba()).post('/api/admin/auth-tracking/resumen').expect(401);
  });

  test('un usuario común recibe 403', async () => {
    mockUsuarioActual = { id: 7, rol: 'usuario', permisos: [] };
    await request(appDePrueba()).post('/api/admin/auth-tracking/resumen').expect(403);
  });

  test('el administrador puede ver el resumen', async () => {
    mockUsuarioActual = { id: 1, rol: 'administrador', permisos: [] };
    const res = await request(appDePrueba())
      .post('/api/admin/auth-tracking/resumen')
      .send({ dias: 7 })
      .expect(200);

    expect(AuthTracking.resumen).toHaveBeenCalledWith({ dias: 7 });
    expect(res.body).toEqual({ usuarios_total: 3, sesiones_activas: 1 });
  });

  test('eventos recibe paginado y filtros por body', async () => {
    mockUsuarioActual = { id: 1, rol: 'administrador', permisos: [] };
    await request(appDePrueba())
      .post('/api/admin/auth-tracking/eventos')
      .send({ pagina: 2, filtros: { tipo: 'login_success', busqueda: 'demo' } })
      .expect(200);

    expect(AuthTracking.listarEventos).toHaveBeenCalledWith({
      pagina: 2,
      filtros: { tipo: 'login_success', busqueda: 'demo' },
    });
  });

  test('el administrador puede marcar notificaciones como leídas', async () => {
    mockUsuarioActual = { id: 1, rol: 'administrador', permisos: [] };
    const res = await request(appDePrueba())
      .patch('/api/admin/auth-tracking/notificaciones/leidas')
      .send({ ids: [1, 2] })
      .expect(200);

    expect(AuthTracking.marcarNotificacionesLeidas).toHaveBeenCalledWith([1, 2]);
    expect(res.body).toEqual({ actualizadas: 2 });
  });
});
