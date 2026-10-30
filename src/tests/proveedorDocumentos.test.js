jest.mock('../models', () => ({
  sequelize: { transaction: jest.fn(fn => fn({ LOCK: { UPDATE: 'UPDATE' } })) },
  MensajeContacto: { findOne: jest.fn() },
}));
jest.mock('../services/r2/r2.client', () => ({ getR2Client: jest.fn() }));

const sharp = require('sharp');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { MensajeContacto } = require('../models');
const { getR2Client } = require('../services/r2/r2.client');
const Documentos = require('../services/proveedorDocumentos.service');

let perfil, send;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.PROVEEDOR_PRIVATE_BUCKET = 'gesicom-private-test';
  process.env.R2_BUCKET_NAME = 'gesicom-public-test';
  perfil = { documentos: {} };
  MensajeContacto.findOne.mockImplementation(async () => ({ datos_proveedor: perfil, update: jest.fn(async data => { perfil = data.datos_proveedor; }) }));
  send = jest.fn(async () => ({}));
  getR2Client.mockReturnValue({ send });
});
afterAll(() => { delete process.env.PROVEEDOR_PRIVATE_BUCKET; delete process.env.R2_BUCKET_NAME; });

test('la foto de cédula se normaliza y se guarda solo en el bucket privado', async () => {
  const buffer = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#b4c3ab' } }).png().toBuffer();
  const doc = await Documentos.subirPrivado({ buffer, size: buffer.length, mimetype: 'image/png' }, 'cedula');
  expect(doc.key).toMatch(/^proveedores\/documentos\/[0-9]+-[a-f0-9]{24}\.jpg$/);
  const comando = send.mock.calls[0][0];
  expect(comando).toBeInstanceOf(PutObjectCommand);
  expect(comando.input.Bucket).toBe('gesicom-private-test');
  expect(comando.input.CacheControl).toBe('private, no-store');
  expect(doc).not.toHaveProperty('url');
});

test('el contrato requiere PDF real y el firmado solo se acepta después de adjuntar el contrato base', async () => {
  const falso = { buffer: Buffer.from('hola'), size: 4, mimetype: 'application/pdf' };
  await expect(Documentos.normalizar(falso, 'contrato_base')).rejects.toMatchObject({ status: 400 });
  const buffer = Buffer.from('%PDF-1.4\ncontenido\n%%EOF');
  const archivo = { buffer, size: buffer.length, mimetype: 'application/pdf' };
  await expect(Documentos.guardarDocumento(41, 'contrato_firmado', archivo)).rejects.toMatchObject({ status: 409 });
  expect((await Documentos.guardarDocumento(41, 'contrato_base', archivo)).contrato_estado).toBe('pendiente_firma');
  expect((await Documentos.guardarDocumento(41, 'contrato_firmado', archivo)).contrato_estado).toBe('pendiente_revision');
  expect((await Documentos.revisarContrato(41, { estado: 'validado' })).contrato_estado).toBe('validado');
});

test('nunca escribe documentos sensibles en el bucket público', async () => {
  process.env.PROVEEDOR_PRIVATE_BUCKET = 'gesicom-public-test';
  const buffer = Buffer.from('%PDF-1.4\ncontenido\n%%EOF');
  await expect(Documentos.subirPrivado({ buffer, size: buffer.length, mimetype: 'application/pdf' }, 'contrato_base')).rejects.toMatchObject({ status: 503 });
  expect(send).not.toHaveBeenCalled();
});
