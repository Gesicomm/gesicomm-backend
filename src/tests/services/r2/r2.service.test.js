'use strict';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  class MockCommand {
    constructor(input) {
      this.input = input;
    }
  }

  return {
    S3Client: jest.fn(() => ({ send: mockSend })),
    PutObjectCommand: MockCommand,
    GetObjectCommand: MockCommand,
    DeleteObjectCommand: MockCommand,
    HeadObjectCommand: MockCommand,
    ListObjectsV2Command: MockCommand,
  };
});

jest.mock('../../../utils/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn() },
}));

const { R2Service, IMMUTABLE_CACHE_CONTROL } = require('../../../services/r2/r2.service');
const { resetR2ClientForTests } = require('../../../services/r2/r2.client');

const envOriginal = process.env;

function setR2Env() {
  process.env = {
    ...envOriginal,
    R2_ACCOUNT_ID: 'account-id',
    R2_ACCESS_KEY_ID: 'access-key',
    R2_SECRET_ACCESS_KEY: 'secret-key',
    R2_BUCKET_NAME: 'gesicomstorage',
    R2_ENDPOINT: 'https://account-id.r2.cloudflarestorage.com',
    R2_REGION: 'auto',
    R2_PUBLIC_BASE_URL: 'https://cdn.gesicomm.com',
  };
}

describe('R2Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetR2ClientForTests();
    setR2Env();
  });

  afterAll(() => {
    process.env = envOriginal;
  });

  test('sube objetos con bucket, content type, cache-control y largo', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await R2Service.uploadObject({
      key: 'products/1/test.webp',
      body: Buffer.from('x'),
      contentType: 'image/webp',
      cacheControl: IMMUTABLE_CACHE_CONTROL,
      contentLength: 1,
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      Bucket: 'gesicomstorage',
      Key: 'products/1/test.webp',
      ContentType: 'image/webp',
      CacheControl: IMMUTABLE_CACHE_CONTROL,
      ContentLength: 1,
    });
    expect(result).toEqual({
      key: 'products/1/test.webp',
      bucket: 'gesicomstorage',
      url: 'https://cdn.gesicomm.com/products/1/test.webp',
    });
  });

  test('consulta metadata de un objeto existente', async () => {
    mockSend.mockResolvedValueOnce({ ContentLength: 123 });

    const result = await R2Service.headObject('products/1/test.webp');

    expect(result.ContentLength).toBe(123);
    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      Bucket: 'gesicomstorage',
      Key: 'products/1/test.webp',
    });
  });

  test('lista objetos por prefijo', async () => {
    mockSend.mockResolvedValueOnce({ Contents: [{ Key: 'products/1/a.webp' }] });

    const result = await R2Service.listObjects('products/1/');

    expect(result).toEqual([{ Key: 'products/1/a.webp' }]);
    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      Prefix: 'products/1/',
    });
  });

  test('normaliza objeto inexistente sin exponer detalles internos', async () => {
    mockSend.mockRejectedValueOnce({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });

    await expect(R2Service.getObject('products/1/missing.webp')).rejects.toMatchObject({
      code: 'NoSuchKey',
      status: 404,
      message: 'El objeto solicitado no existe.',
    });
  });

  test('normaliza credenciales inválidas', async () => {
    mockSend.mockRejectedValueOnce({ name: 'InvalidAccessKeyId' });

    await expect(R2Service.uploadObject({
      key: 'products/1/test.webp',
      body: Buffer.from('x'),
      contentType: 'image/webp',
    })).rejects.toMatchObject({
      code: 'InvalidAccessKeyId',
      message: 'Credenciales de almacenamiento inválidas.',
    });
  });

  test('elimina objetos por key', async () => {
    mockSend.mockResolvedValueOnce({});

    await expect(R2Service.deleteObject('products/1/test.webp')).resolves.toBe(true);
    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      Bucket: 'gesicomstorage',
      Key: 'products/1/test.webp',
    });
  });
});
