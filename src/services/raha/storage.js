'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getR2Client } = require('../r2/r2.client');
const MAX_SIZE = 8 * 1024 * 1024;
const fail = message => Object.assign(new Error(message), { status: 400 });
function privateBucket() {
  const bucket = process.env.RAHA_PRIVATE_BUCKET;
  if (!bucket || bucket === process.env.R2_BUCKET_NAME) throw Object.assign(new Error('Configure un bucket privado independiente para los documentos Raha.'), { status: 503 });
  return bucket;
}
function localPath(key) {
  if (!/^raha\/[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/.test(key)) throw fail('Documento invalido.');
  const root = path.resolve(process.env.RAHA_PRIVATE_STORAGE_PATH || path.join(__dirname, '../../../storage-private'));
  return path.join(root, key);
}
async function normalize(file) {
  if (!file?.buffer?.length || file.size > MAX_SIZE) throw fail('Archivo vacio o mayor a 8 MB.');
  let body = file.buffer, mime = file.mimetype, ext;
  if (mime === 'application/pdf') {
    if (!body.subarray(0, 5).equals(Buffer.from('%PDF-')) || !body.subarray(-2048).includes(Buffer.from('%%EOF'))) throw fail('El archivo no es un PDF valido.');
    ext = 'pdf';
  } else if (['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
    try {
      const image = sharp(body, { limitInputPixels: 40000000, animated: false });
      const metadata = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('Formato');
      body = await image.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
      mime = 'image/jpeg'; ext = 'jpg';
    } catch { throw fail('La imagen no es valida. Usa JPG, PNG o WebP.'); }
  } else throw fail('Solo se permiten PDF, JPG, PNG o WebP.');
  const base = path.basename(file.originalname.replace(/\\/g, '/')).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0, 150).replace(/\.[^.]+$/, '') || 'documento';
  return { body, mime, nombre: `${base}.${ext}`, size: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex'), ext };
}
async function put(file) {
  const normalized = await normalize(file);
  const key = `raha/${crypto.randomUUID()}.${normalized.ext}`;
  const backend = process.env.RAHA_PRIVATE_BUCKET ? 'r2' : 'local';
  if (backend === 'r2') {
    const bucket = privateBucket();
    await getR2Client().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: normalized.body, ContentType: normalized.mime, CacheControl: 'private, no-store' }));
  }
  else {
    if (process.env.NODE_ENV === 'production') throw Object.assign(new Error('El almacenamiento privado Raha no esta configurado.'), { status: 503 });
    const filename = localPath(key);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, normalized.body, { flag: 'wx', mode: 0o600 });
  }
  const { body, ext, ...metadata } = normalized;
  return { ...metadata, storage_key: key, storage_backend: backend };
}
async function read(doc) {
  if (doc.storage_backend === 'local') return fs.readFile(localPath(doc.storage_key));
  const object = await getR2Client().send(new GetObjectCommand({ Bucket: privateBucket(), Key: doc.storage_key }));
  return Buffer.from(await object.Body.transformToByteArray());
}
async function remove(doc) {
  if (doc.storage_backend === 'local') return fs.unlink(localPath(doc.storage_key));
  return getR2Client().send(new DeleteObjectCommand({ Bucket: privateBucket(), Key: doc.storage_key }));
}
module.exports = { MAX_SIZE, normalize, put, read, remove };
