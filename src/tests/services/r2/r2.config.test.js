'use strict';

const { getR2Config, buildPublicUrl, R2ConfigError } = require('../../../services/r2/r2.config');

const envCompleto = {
  R2_ACCOUNT_ID: 'account-id',
  R2_ACCESS_KEY_ID: 'access-key',
  R2_SECRET_ACCESS_KEY: 'secret-key',
  R2_BUCKET_NAME: 'gesicomstorage',
  R2_ENDPOINT: 'https://account-id.r2.cloudflarestorage.com',
  R2_REGION: 'auto',
};

describe('R2 config', () => {
  test('lee la configuración obligatoria con los nombres existentes', () => {
    const config = getR2Config(envCompleto);

    expect(config.bucketName).toBe('gesicomstorage');
    expect(config.endpoint).toBe(envCompleto.R2_ENDPOINT);
    expect(config.region).toBe('auto');
  });

  test('falla con el nombre de la variable faltante sin exponer valores', () => {
    const env = { ...envCompleto };
    delete env.R2_SECRET_ACCESS_KEY;

    expect(() => getR2Config(env)).toThrow(R2ConfigError);
    expect(() => getR2Config(env)).toThrow('R2 configuration error: R2_SECRET_ACCESS_KEY is missing');
  });

  test('construye URL pública desde R2_PUBLIC_BASE_URL cuando existe', () => {
    const url = buildPublicUrl('products/123/image.webp', {
      R2_PUBLIC_BASE_URL: 'https://cdn.gesicomm.com/',
    });

    expect(url).toBe('https://cdn.gesicomm.com/products/123/image.webp');
  });

  test('si no hay dominio público mantiene una ruta relativa al storage_key', () => {
    expect(buildPublicUrl('products/123/image.webp', {})).toBe('/products/123/image.webp');
  });
});
