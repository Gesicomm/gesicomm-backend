jest.mock('../middleware/autenticacion', () => ({
  verificarToken: (req, _res, next) => { req.usuario = { id: 7 }; next(); },
}));
jest.mock('../utils/logger', () => ({ auditoria: jest.fn(), logger: { error: jest.fn() } }));
jest.mock('../services/marcaPersonalMeta.service', () => ({
  urlAutorizacion: jest.fn((state) => `https://www.facebook.com/v23.0/dialog/oauth?state=${state}`),
  completarFacebook: jest.fn(),
  paginasDe: jest.fn(async () => [{ id: '1', nombre: 'A' }, { id: '2', nombre: 'B' }]),
  confirmarPagina: jest.fn(async () => ({ conectada: 'B', instagram: 'mimarca', permisos_faltantes: [] })),
  estado: jest.fn(async () => ({ conexiones: [], disponible: true })),
}));

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const service = require('../services/marcaPersonalMeta.service');
const router = require('../routes/marcaPersonalMeta');

/**
 * Rutas de conexión de Marca Personal (un solo login de Facebook para la
 * Página y su Instagram): el estado de OAuth y los avisos viajan en cookies
 * cifradas, nunca en la URL; solo se aceptan pedidos del proxy.
 */
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth/marca-personal/meta', router);
const ORIGEN = 'https://automation.gesicomm.com';
const BASE = '/api/auth/marca-personal/meta';
const cookies = (res) => (res.headers['set-cookie'] || []).filter((c) => !/=;/.test(c)).map((c) => c.split(';')[0]);

async function conectar(code = 'c1', stateOverride) {
  const inicio = await request(app).get(BASE + '/facebook/conectar').set('Origin', ORIGEN);
  const state = stateOverride || new URL(inicio.headers.location).searchParams.get('state');
  return { inicio, vuelta: await request(app).get(`${BASE}/facebook/callback?code=${code}&state=${state}`).set('Origin', ORIGEN).set('Cookie', cookies(inicio)) };
}

describe('Marca Personal · rutas de conexión', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rechaza pedidos que no vienen del proxy de Marca Personal', async () => {
    expect((await request(app).get(BASE + '/estado')).status).toBe(403);
    expect((await request(app).get(BASE + '/estado').set('Origin', 'https://evil.test')).status).toBe(403);
  });

  test('una sola Página: conecta Página e Instagram y avisa una sola vez', async () => {
    service.completarFacebook.mockResolvedValue({ conectada: 'Mi Marca', instagram: 'mimarca', permisos_faltantes: [] });
    const { inicio, vuelta } = await conectar();
    expect(inicio.status).toBe(302);
    expect(inicio.headers['set-cookie'][0]).toMatch(/Path=\/gesicom-auth\/marca-personal\/meta;.*HttpOnly/);
    expect(cookies(inicio)[0]).not.toContain(new URL(inicio.headers.location).searchParams.get('state'));
    expect(vuelta.headers.location).toBe('/gesicomm-redes.html');
    expect(service.completarFacebook).toHaveBeenCalledWith(7, 'c1');

    const estado = await request(app).get(BASE + '/estado').set('Origin', ORIGEN).set('Cookie', cookies(vuelta));
    expect(estado.body.aviso).toEqual({ tipo: 'ok', texto: 'Página «Mi Marca» e Instagram @mimarca conectados.' });
    expect(estado.headers['set-cookie'].join()).toMatch(/mp_meta_aviso=;/);
  });

  test('una Página sin Instagram vinculado lo avisa', async () => {
    service.completarFacebook.mockResolvedValue({ conectada: 'Mi Marca', instagram: null, permisos_faltantes: [] });
    const { vuelta } = await conectar();
    const estado = await request(app).get(BASE + '/estado').set('Origin', ORIGEN).set('Cookie', cookies(vuelta));
    expect(estado.body.aviso.tipo).toBe('aviso');
    expect(estado.body.aviso.texto).toContain('No tiene una cuenta profesional de Instagram vinculada');
  });

  test('un state distinto no conecta nada', async () => {
    const { vuelta } = await conectar('c1', 'otro');
    expect(service.completarFacebook).not.toHaveBeenCalled();
    const estado = await request(app).get(BASE + '/estado').set('Origin', ORIGEN).set('Cookie', cookies(vuelta));
    expect(estado.body.aviso.tipo).toBe('error');
  });

  test('varias Páginas: las lista y conecta la elegida sin exponer el token', async () => {
    service.completarFacebook.mockResolvedValue({ pendiente: { token: 'usuario', metaUser: '900' } });
    const { vuelta } = await conectar('c');
    const pendiente = cookies(vuelta);
    expect(pendiente.join()).not.toContain('usuario');

    const estado = await request(app).get(BASE + '/estado').set('Origin', ORIGEN).set('Cookie', pendiente);
    expect(estado.body.paginas_pendientes).toHaveLength(2);
    const ok = await request(app).post(BASE + '/facebook/confirmar').set('Origin', ORIGEN).set('Cookie', pendiente).send({ page_id: '2' });
    expect(ok.body).toEqual({ conectada: 'B', instagram: 'mimarca', aviso: { tipo: 'ok', texto: 'Página «B» e Instagram @mimarca conectados.' } });
    expect(service.confirmarPagina).toHaveBeenCalledWith(7, expect.objectContaining({ token: 'usuario', metaUser: '900' }), '2');
  });

  test('sin Página pendiente no se puede confirmar', async () => {
    const res = await request(app).post(BASE + '/facebook/confirmar').set('Origin', ORIGEN).send({ page_id: '2' });
    expect(res.status).toBe(409);
  });
});
