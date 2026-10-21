jest.mock('../services/raha/service', () => ({ upload: jest.fn() }));
jest.mock('../services/raha/dossier', () => ({ enviarExpediente: jest.fn() }));
jest.mock('../services/raha/operaciones', () => ({}));
jest.mock('../services/raha/storage', () => ({ MAX_SIZE: 8 * 1024 * 1024 }));
jest.mock('../middleware/autenticacion', () => ({ verificarToken: (req, res, next) => { req.usuario = { id: 1 }; next(); } }));
jest.mock('../middleware/resolverTiendaActiva', () => ({ resolverTiendaActiva: (req, res, next) => next() }));

const express = require('express');
const request = require('supertest');
const service = require('../services/raha/service');
const { MAX_SIZE } = require('../services/raha/storage');
const app = express();
app.use('/api/integraciones/raha', require('../routes/raha'));

beforeEach(() => jest.clearAllMocks());

test.each(['ruc', 'cedula'])('devuelve un error de tamaño interpretable al subir %s', async tipo => {
  const res = await request(app).post('/api/integraciones/raha/documentos')
    .field('tipo', tipo).field('version', '1')
    .attach('archivo', Buffer.alloc(MAX_SIZE + 1), { filename: 'documento.png', contentType: 'image/png' });
  expect(res.status).toBe(413);
  expect(res.body).toMatchObject({ code: 'FILE_TOO_LARGE', maxSizeBytes: MAX_SIZE });
  expect(res.body.message).toContain('8 MB por documento');
  expect(service.upload).not.toHaveBeenCalled();
});

test('los archivos pequeños llegan al servicio como antes', async () => {
  service.upload.mockResolvedValue({ id: 9, version: 2 });
  const res = await request(app).post('/api/integraciones/raha/documentos')
    .field('tipo', 'ruc').field('version', '1')
    .attach('archivo', Buffer.from('%PDF-test'), { filename: 'ruc.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  expect(service.upload).toHaveBeenCalledWith({ id: 1 }, 'ruc', '1', expect.objectContaining({ originalname: 'ruc.pdf' }));
});
