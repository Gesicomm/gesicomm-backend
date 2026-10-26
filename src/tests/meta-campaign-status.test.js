jest.mock('../models', () => ({ MetaIntegration: { findOne: jest.fn() } }));
jest.mock('../middleware/autenticacion', () => ({
  verificarToken: (req, _res, next) => { req.usuario = { id: 3, tenantId: 1 }; next(); },
}));
jest.mock('../utils/logger', () => ({ auditoria: jest.fn() }));
jest.mock('../utils/EncryptionService', () => ({ decrypt: jest.fn(() => 'token-de-prueba') }));
jest.mock('../controllers/solicitudEliminacion.controller', () => ({ metaCallback: jest.fn() }));

process.env.FACEBOOK_APP_ID = '111';
process.env.FACEBOOK_REDIRECT_URI = 'https://api.test/api/meta/callback';

const express = require('express');
const request = require('supertest');
const { MetaIntegration } = require('../models');
const { auditoria } = require('../utils/logger');
const { permiteRutaModulo } = require('../middleware/modulosColaborador');
const router = require('../routes/meta');

const app = express();
app.use(express.json());
app.use('/api/meta', router);

const payload = { store_id: 7, ad_account_id: 'act_123', campaign_id: '456', status: 'PAUSED' };
const graphResponse = (body) => ({ ok: true, json: async () => body });

beforeEach(() => {
  jest.clearAllMocks();
  MetaIntegration.findOne.mockResolvedValue({ id: 7, business_id: '10', access_token: 'cifrado' });
  global.fetch = jest.fn()
    .mockResolvedValueOnce(graphResponse({ id: 'act_123', business: { id: '10' } }))
    .mockResolvedValueOnce(graphResponse({ id: '456', account_id: '123', status: 'ACTIVE' }))
    .mockResolvedValueOnce(graphResponse({ success: true }));
});

test('el flujo de conexión solicita ads_management', async () => {
  const res = await request(app).get('/api/meta/connect');
  expect(res.status).toBe(302);
  const url = new URL(res.headers.location);
  expect(url.searchParams.get('scope').split(',')).toEqual(['ads_read', 'ads_management', 'business_management']);
});

test('solo colaboradores que gestionan Publicidad pueden cambiar el estado', () => {
  const req = { originalUrl: '/api/meta/campaign-status', method: 'POST', usuario: { tiendaId: 5, accesos: { publicidad: 'ver' } } };
  expect(permiteRutaModulo(req)).toBe(false);
  req.usuario.accesos.publicidad = 'gestionar';
  expect(permiteRutaModulo(req)).toBe(true);
});

test('pausa en Meta una campaña del portafolio conectado y audita la acción', async () => {
  const res = await request(app).post('/api/meta/campaign-status').send(payload);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ id: '456', status: 'PAUSED' });
  expect(MetaIntegration.findOne).toHaveBeenCalledWith({
    where: { id: 7, inquilino_id: 1, usuario_id: 3, estado: 'conectado' },
  });
  expect(global.fetch).toHaveBeenCalledTimes(3);
  const [url, options] = global.fetch.mock.calls[2];
  expect(url).toMatch(/\/456$/);
  expect(options.method).toBe('POST');
  expect(options.body.get('status')).toBe('PAUSED');
  expect(auditoria).toHaveBeenCalledWith('META_CAMPANA_ESTADO', expect.objectContaining({ campaignId: '456', status: 'PAUSED' }));
});

test('activa en Meta una campaña pausada', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(graphResponse({ id: 'act_123', business: { id: '10' } }))
    .mockResolvedValueOnce(graphResponse({ id: '456', account_id: '123', status: 'PAUSED' }))
    .mockResolvedValueOnce(graphResponse({ success: true }));
  const res = await request(app).post('/api/meta/campaign-status').send({ ...payload, status: 'ACTIVE' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ id: '456', status: 'ACTIVE' });
  expect(global.fetch.mock.calls[2][1].body.get('status')).toBe('ACTIVE');
});

test('impide escribir en una cuenta de otro portafolio', async () => {
  global.fetch = jest.fn().mockResolvedValue(graphResponse({ id: 'act_123', business: { id: '99' } }));
  const res = await request(app).post('/api/meta/campaign-status').send(payload);
  expect(res.status).toBe(403);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(auditoria).not.toHaveBeenCalled();
});

test('impide escribir en una campaña de otra cuenta', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(graphResponse({ id: 'act_123', business: { id: '10' } }))
    .mockResolvedValueOnce(graphResponse({ id: '456', account_id: '999', status: 'ACTIVE' }));
  const res = await request(app).post('/api/meta/campaign-status').send(payload);
  expect(res.status).toBe(403);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('indica renovar permisos cuando Meta deniega la edición', async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(graphResponse({ id: 'act_123', business: { id: '10' } }))
    .mockResolvedValueOnce(graphResponse({ id: '456', account_id: '123', status: 'ACTIVE' }))
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { code: 200, message: 'Permissions error' } }) });
  const res = await request(app).post('/api/meta/campaign-status').send(payload);
  expect(res.status).toBe(403);
  expect(res.body.message).toMatch(/Renová los permisos/);
  expect(auditoria).not.toHaveBeenCalled();
});

test('rechaza estados e identificadores no admitidos sin llamar a Meta', async () => {
  const res = await request(app).post('/api/meta/campaign-status').send({ ...payload, campaign_id: '../me', status: 'ARCHIVED' });
  expect(res.status).toBe(400);
  expect(global.fetch).not.toHaveBeenCalled();
});
