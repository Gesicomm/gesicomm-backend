/**
 * Page Builder — acceso (T-24).
 *
 * Hoy el módulo es exclusivo del administrador. Lo importante de este test
 * es el caso que NO es obvio: un usuario que TIENE el permiso
 * 'gestionar_paginas' igual tiene que recibir 403, porque el gate de hoy
 * es el rol y no el permiso. Si alguien cambia routes/pageBuilder.js por
 * verificarPermiso() antes de tiempo, este test se cae.
 */

const express = require('express');
const request = require('supertest');

// El rol lo pone cada test antes de la request.
let mockUsuarioActual = null;

jest.mock('../middleware/autenticacion', () => ({
  verificarToken: (req, res, next) => {
    if (!mockUsuarioActual) return res.status(401).json({ message: 'No autenticado.' });
    req.usuario = mockUsuarioActual;
    next();
  },
}));

// Los services no se tocan: si un request llegara a pasar el gate, se
// nota igual porque el controller respondería otra cosa que un 403.
jest.mock('../services/builderProject.service', () => ({
  listar: jest.fn(async () => ({ total: 0, proyectos: [] })),
  crear: jest.fn(async () => ({ id: 1 })),
}));

const { soloAdministrador } = require('../middleware/soloAdministrador');
const pageBuilderRoutes = require('../routes/pageBuilder');

function appDePrueba() {
  const app = express();
  app.use(express.json());
  app.use('/api/page-builder', pageBuilderRoutes);
  return app;
}

beforeEach(() => {
  mockUsuarioActual = null;
});

describe('soloAdministrador (unidad)', () => {
  const corre = (usuario) => {
    const req = { usuario };
    const res = {
      statusCode: null, cuerpo: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.cuerpo = b; return this; },
    };
    const next = jest.fn();
    soloAdministrador(req, res, next);
    return { res, next };
  };

  test('deja pasar al administrador', () => {
    const { next } = corre({ id: 1, rol: 'administrador' });
    expect(next).toHaveBeenCalled();
  });

  test('corta a un usuario común con 403', () => {
    const { res, next } = corre({ id: 2, rol: 'usuario' });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('corta también si NO hay usuario en el request', () => {
    const { res, next } = corre(undefined);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe('GET/POST /api/page-builder', () => {

  test('sin sesión responde 401', async () => {
    await request(appDePrueba()).get('/api/page-builder/proyectos').expect(401);
  });

  test('un usuario con rol "usuario" recibe 403', async () => {
    mockUsuarioActual = { id: 3, rol: 'usuario', tenantId: 2, permisos: [] };
    await request(appDePrueba()).get('/api/page-builder/proyectos').expect(403);
  });

  test('un usuario CON el permiso gestionar_paginas igual recibe 403', async () => {
    // El gate de hoy es el rol, no el permiso: el permiso existe en el
    // seed pero routes/pageBuilder.js todavía usa soloAdministrador.
    mockUsuarioActual = { id: 4, rol: 'usuario', tenantId: 2, permisos: ['gestionar_paginas'] };
    await request(appDePrueba()).get('/api/page-builder/proyectos').expect(403);
    await request(appDePrueba())
      .post('/api/page-builder/proyectos').send({ nombre: 'X' }).expect(403);
  });

  test('el administrador entra', async () => {
    mockUsuarioActual = { id: 1, rol: 'administrador', tenantId: 2, permisos: [] };
    await request(appDePrueba()).get('/api/page-builder/proyectos').expect(200);
  });

  test('las rutas privadas no dependen de tener una tienda', async () => {
    // Ningún administrador tiene tienda propia. Si el módulo resolviera
    // una Tienda como hacen las landings, esto daría 409 y el módulo sería
    // inusable justo para el único rol que hoy lo puede usar.
    mockUsuarioActual = { id: 1, rol: 'administrador', tenantId: 2, permisos: [] };
    const res = await request(appDePrueba())
      .post('/api/page-builder/proyectos').send({ nombre: 'Mi Negocio' });
    expect(res.status).toBe(201);
  });
});
