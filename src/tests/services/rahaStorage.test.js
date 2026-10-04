const storage = require('../../services/raha/storage');
const sharp = require('sharp');
describe('Private Raha documents', () => {
  test('rejects MIME-spoofed PDF and executable uploads', async () => {
    await expect(storage.normalize({ buffer: Buffer.from('not a pdf'), size: 9, mimetype: 'application/pdf', originalname: 'ci.pdf' })).rejects.toMatchObject({ status: 400 });
    await expect(storage.normalize({ buffer: Buffer.from('<svg/>'), size: 6, mimetype: 'image/svg+xml', originalname: 'ci.svg' })).rejects.toMatchObject({ status: 400 });
  });
  test('rejects truncated images and oversized files', async () => {
    await expect(storage.normalize({ buffer: Buffer.from('fake'), size: 4, mimetype: 'image/png', originalname: 'ci.png' })).rejects.toMatchObject({ status: 400 });
    await expect(storage.normalize({ buffer: Buffer.from('x'), size: storage.MAX_SIZE + 1, mimetype: 'image/png', originalname: 'ci.png' })).rejects.toMatchObject({ status: 400 });
  });
  test('reencodes images and sanitizes paths, keeps a checksum and no public URL', async () => {
    const buffer = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#f00' } }).png().toBuffer();
    const result = await storage.normalize({ buffer, size: buffer.length, mimetype: 'image/png', originalname: '../../ci.png' });
    expect(result.nombre).toBe('ci.jpg'); expect(result.mime).toBe('image/jpeg');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/); expect(result.url).toBeUndefined();
    expect((await sharp(result.body).metadata()).format).toBe('jpeg');
  });
  test('fails closed in production without private bucket or with public bucket', async () => {
    const prev = { NODE_ENV: process.env.NODE_ENV, RAHA_PRIVATE_BUCKET: process.env.RAHA_PRIVATE_BUCKET, R2_BUCKET_NAME: process.env.R2_BUCKET_NAME };
    try {
      process.env.NODE_ENV = 'production'; delete process.env.RAHA_PRIVATE_BUCKET;
      const file = { buffer: Buffer.from('%PDF-1.4\n%%EOF'), size: 14, mimetype: 'application/pdf', originalname: 'ci.pdf' };
      await expect(storage.put(file)).rejects.toMatchObject({ status: 503 });
      process.env.RAHA_PRIVATE_BUCKET = 'public'; process.env.R2_BUCKET_NAME = 'public';
      await expect(storage.put(file)).rejects.toMatchObject({ status: 503 });
    } finally { for (const [key, value] of Object.entries(prev)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
});
