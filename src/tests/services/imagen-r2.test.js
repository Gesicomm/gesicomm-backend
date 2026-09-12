'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

jest.mock('../../models', () => ({
  ProductoImagen: {
    findAll: jest.fn(),
    max: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn(),
  },
}));

jest.mock('../../services/r2/r2.service', () => ({
  IMMUTABLE_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  R2Service: {
    uploadObject: jest.fn(({ key }) => Promise.resolve({
      key,
      bucket: 'gesicomstorage',
      url: `https://cdn.gesicomm.com/${key}`,
    })),
    deleteObject: jest.fn(() => Promise.resolve(true)),
  },
}));

const ImagenService = require('../../services/imagen.service');
const { ProductoImagen } = require('../../models');
const { R2Service, IMMUTABLE_CACHE_CONTROL } = require('../../services/r2/r2.service');

const tmpDir = path.join(process.cwd(), 'tmp', 'uploads');
const envOriginal = process.env;

async function crearImagenTemporal(nombre = 'test.png') {
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `${Date.now()}-${nombre}`);
  const buffer = await sharp({
    create: {
      width: 40,
      height: 30,
      channels: 3,
      background: '#ff0000',
    },
  }).png().toBuffer();
  await fs.promises.writeFile(filePath, buffer);
  return {
    path: filePath,
    mimetype: 'image/png',
    originalname: nombre,
  };
}

describe('ImagenService con R2 para productos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...envOriginal,
      R2_PUBLIC_BASE_URL: 'https://cdn.gesicomm.com',
    };
    ProductoImagen.max.mockResolvedValue(0);
    ProductoImagen.update.mockResolvedValue([1]);
    ProductoImagen.create.mockImplementation((payload) => Promise.resolve(payload));
  });

  afterAll(() => {
    process.env = envOriginal;
  });

  test('procesa con Sharp, sube WebP a R2 y persiste metadata', async () => {
    const file = await crearImagenTemporal();

    const imagen = await ImagenService.subir(123, 10, file, { es_principal: 'true' });

    expect(R2Service.uploadObject).toHaveBeenCalledTimes(1);
    const uploadArgs = R2Service.uploadObject.mock.calls[0][0];
    expect(uploadArgs.key).toMatch(/^products\/123\/[0-9a-f-]+\.webp$/);
    expect(uploadArgs.contentType).toBe('image/webp');
    expect(uploadArgs.cacheControl).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(uploadArgs.contentLength).toBeGreaterThan(0);

    expect(ProductoImagen.update).toHaveBeenCalledWith({ es_principal: false }, { where: { producto_id: 123 } });
    expect(ProductoImagen.create).toHaveBeenCalledWith(expect.objectContaining({
      inquilino_id: 10,
      producto_id: 123,
      storage_key: uploadArgs.key,
      url: `https://cdn.gesicomm.com/${uploadArgs.key}`,
      mime_type: 'image/webp',
      size: uploadArgs.contentLength,
      width: 40,
      height: 30,
      es_principal: true,
      orden: 1,
    }));
    expect(imagen.storage_key).toBe(uploadArgs.key);
    expect(fs.existsSync(file.path)).toBe(false);
  });

  test('lista imágenes recalculando la URL pública desde storage_key', async () => {
    ProductoImagen.findAll.mockResolvedValueOnce([
      {
        toJSON: () => ({
          id: 365,
          producto_id: 346,
          url: '/products/346/535227de.webp',
          storage_key: 'products/346/535227de.webp',
        }),
      },
    ]);

    const imagenes = await ImagenService.listarPorProducto(346, 2);

    expect(imagenes[0].url).toBe('https://cdn.gesicomm.com/products/346/535227de.webp');
  });

  test('genera keys únicas para reemplazos o cargas repetidas', async () => {
    const fileA = await crearImagenTemporal('a.png');
    const fileB = await crearImagenTemporal('b.png');

    await ImagenService.subir(123, 10, fileA, {});
    await ImagenService.subir(123, 10, fileB, {});

    const keys = R2Service.uploadObject.mock.calls.map(([args]) => args.key);
    expect(keys[0]).not.toBe(keys[1]);
  });

  test('elimina primero el objeto R2 y luego la metadata', async () => {
    const destroy = jest.fn(() => Promise.resolve());
    ProductoImagen.findOne.mockResolvedValue({
      storage_key: 'products/123/image.webp',
      url: 'https://cdn.gesicomm.com/products/123/image.webp',
      destroy,
    });

    await expect(ImagenService.eliminar(1, 123, 10)).resolves.toBe(true);

    expect(R2Service.deleteObject).toHaveBeenCalledWith('products/123/image.webp');
    expect(destroy).toHaveBeenCalled();
  });

  test('informa objeto inexistente sin tocar DB', async () => {
    ProductoImagen.findOne.mockResolvedValue(null);

    await expect(ImagenService.eliminar(1, 123, 10)).rejects.toThrow('Imagen no encontrada.');
    expect(R2Service.deleteObject).not.toHaveBeenCalled();
  });
});
