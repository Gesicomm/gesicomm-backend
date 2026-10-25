jest.mock('../models', () => ({
  MetaIntegration: { findOrCreate: jest.fn(), findAll: jest.fn() },
}));
jest.mock('../middleware/autenticacion', () => ({
  verificarToken: (req, _res, next) => { req.usuario = { id: 3, tenantId: 1 }; next(); },
}));
jest.mock('../utils/logger', () => ({ auditoria: jest.fn() }));
jest.mock('../controllers/solicitudEliminacion.controller', () => ({ metaCallback: jest.fn() }));

process.env.FACEBOOK_APP_ID = '111';
process.env.FACEBOOK_APP_SECRET = 'secreto';
process.env.FACEBOOK_REDIRECT_URI = 'https://api.test/api/meta/callback';
process.env.FRONTEND_URL = 'https://app.test';

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { MetaIntegration } = require('../models');
const EncryptionService = require('../utils/EncryptionService');
const metaRouter = require('../routes/meta');

/**
 * Con varios portafolios autorizados en Meta, la conexión queda pendiente y
 * el usuario elige cuáles guardar. Antes se guardaba siempre el primero.
 * Unitario: modelos y Graph API simulados, no toca la base ni Meta.
 */
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/meta', metaRouter);

const BMS = [{ id: '10', name: 'Callback Dev' }, { id: '20', name: 'Tienda Asunción' }];

const respuestaGraph = (bms) => async (url) => {
  const u = String(url);
  let body;
  if (u.includes('/oauth/access_token')) body = { access_token: 'token-largo' };
  else if (u.includes('/me/businesses')) body = { data: bms };
  else if (u.includes('/me?fields=id')) body = { id: '555' };
  else body = { error: { message: 'inesperado ' + u } };
  return { json: async () => body };
};

const callback = () => request(app)
  .get('/api/meta/callback?code=abc&state=s1')
  .set('Cookie', ['meta_oauth_state=s1', 'meta_oauth_tenant=1', 'meta_oauth_user=3', 'meta_oauth_redirect=/settings']);

const cookiePendiente = (res) => (res.headers['set-cookie'] || [])
  .find((c) => c.startsWith('meta_oauth_pendiente=') && !c.startsWith('meta_oauth_pendiente=;'));

describe('Meta: elegir portafolios al conectar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MetaIntegration.findOrCreate.mockResolvedValue([{ update: jest.fn() }, true]);
    MetaIntegration.findAll.mockResolvedValue([]);
  });

  test('con un solo portafolio lo conecta directo', async () => {
    global.fetch = jest.fn(respuestaGraph([BMS[0]]));
    const res = await callback();
    expect(res.headers.location).toBe('https://app.test/settings?meta_success=true');
    expect(MetaIntegration.findOrCreate).toHaveBeenCalledTimes(1);
    expect(cookiePendiente(res)).toBeUndefined();
  });

  test('con varios no guarda nada y deja la elección pendiente', async () => {
    global.fetch = jest.fn(respuestaGraph(BMS));
    const res = await callback();
    expect(res.headers.location).toBe('https://app.test/settings');
    expect(MetaIntegration.findOrCreate).not.toHaveBeenCalled();
    const cookie = cookiePendiente(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).not.toContain('token-largo');
  });

  test('lista los portafolios y conecta solo los elegidos', async () => {
    global.fetch = jest.fn(respuestaGraph(BMS));
    const cookie = cookiePendiente(await callback()).split(';')[0];
    MetaIntegration.findAll.mockResolvedValue([{ business_id: '10' }]);

    const lista = await request(app).get('/api/meta/pendiente').set('Cookie', cookie);
    expect(lista.body).toEqual({
      pendiente: true,
      portafolios: [
        { id: '10', nombre: 'Callback Dev', conectado: true },
        { id: '20', nombre: 'Tienda Asunción', conectado: false },
      ],
    });

    const ok = await request(app).post('/api/meta/pendiente/confirmar').set('Cookie', cookie).send({ business_ids: ['20'] });
    expect(ok.body).toEqual({ conectados: 1 });
    expect(MetaIntegration.findOrCreate).toHaveBeenCalledTimes(1);
    const { where, defaults } = MetaIntegration.findOrCreate.mock.calls[0][0];
    expect(where).toEqual({ inquilino_id: 1, usuario_id: 3, business_id: '20' });
    expect(defaults.business_name).toBe('Tienda Asunción');
    expect(EncryptionService.decrypt(defaults.access_token)).toBe('token-largo');
  });

  test('rechaza un portafolio que Meta no autorizó', async () => {
    global.fetch = jest.fn(respuestaGraph(BMS));
    const cookie = cookiePendiente(await callback()).split(';')[0];
    const res = await request(app).post('/api/meta/pendiente/confirmar').set('Cookie', cookie).send({ business_ids: ['99'] });
    expect(res.status).toBe(400);
    expect(MetaIntegration.findOrCreate).not.toHaveBeenCalled();
  });

  test('sin cookie o con la de otro usuario no hay nada pendiente', async () => {
    const ajena = EncryptionService.encrypt(JSON.stringify({ token: 't', tenantId: '1', userId: '99', expira: Date.now() + 60000 }));
    expect((await request(app).get('/api/meta/pendiente')).body).toEqual({ pendiente: false });
    expect((await request(app).get('/api/meta/pendiente').set('Cookie', 'meta_oauth_pendiente=' + ajena)).body).toEqual({ pendiente: false });
    const res = await request(app).post('/api/meta/pendiente/confirmar').set('Cookie', 'meta_oauth_pendiente=' + ajena).send({ business_ids: ['10'] });
    expect(res.status).toBe(410);
  });
});
