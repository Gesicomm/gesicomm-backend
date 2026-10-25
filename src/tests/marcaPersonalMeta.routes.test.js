jest.mock('../middleware/autenticacion', () => ({
  verificarToken: (req, _res, next) => { req.usuario = { id: 7 }; next(); },
}));
jest.mock('../utils/logger', () => ({ auditoria: jest.fn(), logger: { error: jest.fn() } }));
jest.mock('../controllers/solicitudEliminacion.controller', () => ({ metaCallbackInstagram: jest.fn() }));
jest.mock('../services/marcaPersonalMeta.service', () => ({
  urlAutorizacion: jest.fn((p, state) => `https://www.instagram.com/oauth/authorize?state=${state}`),
  completarInstagram: jest.fn(async () => ({ username: 'mimarca', permisos_faltantes: [] })),
  completarFacebook: jest.fn(),
  paginasDe: jest.fn(async () => [{ id: '1', nombre: 'A' }, { id: '2', nombre: 'B' }]),
  confirmarPagina: jest.fn(async () => ({ conectada: 'B' })),
  estado: jest.fn(async () => ({ conexiones: [], disponible: { instagram: true, facebook: true } })),
}));

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const service = require('../services/marcaPersonalMeta.service');
const { router } = require('../routes/marcaPersonalMeta');

/**
 * Rutas de conexión de Marca Personal: el estado de OAuth y los avisos viajan
 * en cookies cifradas, nunca en la URL; solo se aceptan pedidos del proxy.
 */
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth/marca-personal/meta', router);
const ORIGEN = 'https://automation.gesicomm.com';
const BASE = '/api/auth/marca-personal/meta';
const cookies = (res) => (res.headers['set-cookie'] || []).filter((c) => !/=;/.test(c)).map((c) => c.split(';')[0]);

describe('Marca Personal · rutas de conexión', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rechaza pedidos que no vienen del proxy de Marca Personal', async () => {
    expect((await request(app).get(BASE + '/estado')).status).toBe(403);
    expect((await request(app).get(BASE + '/estado').set('Origin', 'https://evil.test')).status).toBe(403);
  });

  test('Instagram: conectar, volver con el mismo state y ver el aviso una sola vez', async () => {
    const inicio = await request(app).get(BASE + '/instagram/conectar').set('Origin', ORIGEN);
    expect(inicio.status).toBe(302);
    const state = new URL(inicio.headers.location).searchParams.get('state');
    const oauth = cookies(inicio);
    expect(oauth[0]).not.toContain(state);
    expect(inicio.headers['set-cookie'][0]).toMatch(/Path=\/gesicom-auth\/marca-personal\/meta;.*HttpOnly/);

    const vuelta = await request(app).get(`${BASE}/instagram/callback?code=c1&state=${state}`).set('Origin', ORIGEN).set('Cookie', oauth);
    expect(vuelta.headers.location).toBe('/gesicomm-redes.html');
    expect(service.completarInstagram).toHaveBeenCalledWith(7, 'c1');

    const aviso = cookies(vuelta);
    const estado = await request(app).get(BASE + '/estado').set('Origin', ORIGEN).set('Cookie', aviso);
    expect(estado.body.aviso).toEqual({ tipo: 'ok', texto: 'Instagram @mimarca conectado.' });
    expect(estado.headers['set-cookie'].join()).toMatch(/mp_meta_aviso=;/);
  });

  test('un state distinto no conecta nada', async () => {
    const inicio = await request(app).get(BASE + '/instagram/conectar').set('Origin', ORIGEN);
    const vuelta = await request(app).get(`${BASE}/instagram/callback?code=c1&state=otro`).set('Origin', ORIGEN).set('Cookie', cookies(inicio));
    expect(service.completarInstagram).not.toHaveBeenCalled();
    const estado = await request(app).get(BASE + '/estado').set('Origin', ORIGEN).set('Cookie', cookies(vuelta));
    expect(estado.body.aviso.tipo).toBe('error');
  });

  test('Facebook con varias Páginas: las lista y conecta la elegida', async () => {
    service.completarFacebook.mockResolvedValue({ pendiente: { token: 'usuario', metaUser: '900' } });
    const inicio = await request(app).get(BASE + '/facebook/conectar').set('Origin', ORIGEN);
    const state = new URL(inicio.headers.location).searchParams.get('state');
    const vuelta = await request(app).get(`${BASE}/facebook/callback?code=c&state=${state}`).set('Origin', ORIGEN).set('Cookie', cookies(inicio));
    const pendiente = cookies(vuelta);
    expect(pendiente.join()).not.toContain('usuario');

    const estado = await request(app).get(BASE + '/estado').set('Origin', ORIGEN).set('Cookie', pendiente);
    expect(estado.body.paginas_pendientes).toHaveLength(2);
    const ok = await request(app).post(BASE + '/facebook/confirmar').set('Origin', ORIGEN).set('Cookie', pendiente).send({ page_id: '2' });
    expect(ok.body).toEqual({ conectada: 'B' });
    expect(service.confirmarPagina).toHaveBeenCalledWith(7, expect.objectContaining({ token: 'usuario', metaUser: '900' }), '2');
  });

  test('sin Página pendiente no se puede confirmar', async () => {
    const res = await request(app).post(BASE + '/facebook/confirmar').set('Origin', ORIGEN).send({ page_id: '2' });
    expect(res.status).toBe(409);
  });
});
