'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HeadObjectCommand } = require('@aws-sdk/client-s3');
const { sequelize } = require('../src/models');
const { R2Service, IMMUTABLE_CACHE_CONTROL } = require('../src/services/r2/r2.service');
const { getR2Client } = require('../src/services/r2/r2.client');
const { getR2Config } = require('../src/services/r2/r2.config');

const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');
const REPORTS_DIR = path.join(process.cwd(), 'reports', 'r2-migration');
const LEGACY_PREFIX = 'legacy/uploads';

const REFERENCED_COLUMNS = [
  { source: 'producto_imagenes.url', table: 'producto_imagenes', idColumn: 'id', column: 'url' },
  { source: 'landings.banner_imagen', table: 'landings', idColumn: 'id', column: 'banner_imagen' },
  { source: 'landings.logo_imagen', table: 'landings', idColumn: 'id', column: 'logo_imagen' },
  { source: 'landings.seo_og_imagen', table: 'landings', idColumn: 'id', column: 'seo_og_imagen' },
  { source: 'landings.content', table: 'landings', idColumn: 'id', column: 'content', isJson: true },
  { source: 'testimonios.foto', table: 'testimonios', idColumn: 'id', column: 'foto' },
  { source: 'ofertas_producto.imagen_url', table: 'ofertas_producto', idColumn: 'id', column: 'imagen_url' },
  { source: 'builder_pages.og_imagen', table: 'builder_pages', idColumn: 'id', column: 'og_imagen' },
  { source: 'builder_pages.favicon_url', table: 'builder_pages', idColumn: 'id', column: 'favicon_url' },
  { source: 'costos_gastos.comprobante_url', table: 'costos_gastos', idColumn: 'id', column: 'comprobante_url' },
];

function parseArgs(argv) {
  const args = new Set(argv);
  return {
    commit: args.has('--commit'),
    dryRun: args.has('--dry-run') || !args.has('--commit'),
    force: args.has('--force'),
  };
}

function normalizeUploadValue(value) {
  if (!value || typeof value !== 'string') return null;
  const clean = value.trim();
  if (!clean.startsWith('/uploads/')) return null;
  return clean.replace(/^\/uploads\/+/, '');
}

function findUploadsInValue(value, found = new Set()) {
  if (typeof value === 'string') {
    const matches = value.match(/\/uploads\/[A-Za-z0-9._-]+/g) || [];
    matches.forEach((match) => found.add(match.replace(/^\/uploads\/+/, '')));
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => findUploadsInValue(item, found));
    return found;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => findUploadsInValue(item, found));
  }
  return found;
}

function contentTypeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  const types = {
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  };
  return types[ext] || 'application/octet-stream';
}

function cacheControlFor(filename) {
  return contentTypeFor(filename).startsWith('image/')
    ? IMMUTABLE_CACHE_CONTROL
    : 'private, max-age=0, no-cache';
}

function storageKeyFor(filename) {
  return `${LEGACY_PREFIX}/${filename}`;
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function listLocalUploads() {
  const entries = await fs.promises.readdir(UPLOADS_DIR, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(UPLOADS_DIR, entry.name);
    const stat = await fs.promises.stat(filePath);
    files.push({
      filename: entry.name,
      filePath,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      contentType: contentTypeFor(entry.name),
      cacheControl: cacheControlFor(entry.name),
      storageKey: storageKeyFor(entry.name),
    });
  }
  files.sort((a, b) => a.filename.localeCompare(b.filename));
  return files;
}

async function collectDbReferences() {
  const referencesByFilename = new Map();
  const addReference = (filename, reference) => {
    if (!referencesByFilename.has(filename)) referencesByFilename.set(filename, []);
    referencesByFilename.get(filename).push(reference);
  };

  for (const def of REFERENCED_COLUMNS) {
    const rows = await sequelize.query(
      `SELECT "${def.idColumn}" AS id, "${def.column}" AS value
       FROM "${def.table}"
       WHERE "${def.column}" IS NOT NULL`,
      { type: sequelize.QueryTypes.SELECT }
    );

    for (const row of rows) {
      const filenames = def.isJson
        ? [...findUploadsInValue(row.value)]
        : [normalizeUploadValue(row.value)].filter(Boolean);

      filenames.forEach((filename) => addReference(filename, {
        source: def.source,
        id: row.id,
      }));
    }
  }

  return referencesByFilename;
}

async function objectExists(key) {
  try {
    await getR2Client().send(new HeadObjectCommand({
      Bucket: getR2Config().bucketName,
      Key: key,
    }));
    return true;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    const code = error?.name || error?.Code || error?.code;
    if (code === 'NoSuchKey' || code === 'NotFound' || status === 404) return false;
    throw error;
  }
}

async function uploadFile(file, { dryRun, force }) {
  if (dryRun) return { status: 'planned' };

  const exists = force ? false : await objectExists(file.storageKey);
  if (exists) return { status: 'already_exists' };

  await R2Service.uploadObject({
    key: file.storageKey,
    body: fs.createReadStream(file.filePath),
    contentType: file.contentType,
    cacheControl: file.cacheControl,
    contentLength: file.size,
  });

  return { status: 'uploaded' };
}

async function writeReports(report) {
  await fs.promises.mkdir(REPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const basePath = path.join(REPORTS_DIR, `phase1-${stamp}`);

  await fs.promises.writeFile(`${basePath}.json`, JSON.stringify(report, null, 2));

  const csvLines = [
    'filename,size,content_type,storage_key,status,db_references,error',
    ...report.files.map((file) => [
      file.filename,
      file.size,
      file.contentType,
      file.storageKey,
      file.status,
      file.references.length,
      file.error || '',
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')),
  ];
  await fs.promises.writeFile(`${basePath}.csv`, `${csvLines.join('\n')}\n`);

  return {
    json: `${basePath}.json`,
    csv: `${basePath}.csv`,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();

  if (!fs.existsSync(UPLOADS_DIR)) {
    throw new Error(`No existe el directorio de uploads: ${UPLOADS_DIR}`);
  }

  const [files, referencesByFilename] = await Promise.all([
    listLocalUploads(),
    collectDbReferences(),
  ]);

  const report = {
    phase: 1,
    mode: options.dryRun ? 'dry-run' : 'commit',
    destructive: false,
    uploadsDir: UPLOADS_DIR,
    legacyPrefix: LEGACY_PREFIX,
    startedAt,
    finishedAt: null,
    summary: {
      totalFiles: files.length,
      referencedFiles: 0,
      unreferencedFiles: 0,
      planned: 0,
      uploaded: 0,
      alreadyExists: 0,
      failed: 0,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    },
    files: [],
  };

  for (const file of files) {
    const references = referencesByFilename.get(file.filename) || [];
    const item = {
      filename: file.filename,
      size: file.size,
      mtime: file.mtime,
      sha256: await sha256File(file.filePath),
      contentType: file.contentType,
      cacheControl: file.cacheControl,
      storageKey: file.storageKey,
      cdnUrl: process.env.R2_PUBLIC_BASE_URL
        ? `${process.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${file.storageKey}`
        : null,
      references,
      status: null,
      error: null,
    };

    try {
      const result = await uploadFile(file, options);
      item.status = result.status;
      if (result.status === 'planned') report.summary.planned++;
      if (result.status === 'uploaded') report.summary.uploaded++;
      if (result.status === 'already_exists') report.summary.alreadyExists++;
    } catch (error) {
      item.status = 'failed';
      item.error = error.message || 'Upload failed';
      report.summary.failed++;
    }

    if (references.length) report.summary.referencedFiles++;
    else report.summary.unreferencedFiles++;

    report.files.push(item);
  }

  report.finishedAt = new Date().toISOString();
  const reportPaths = await writeReports(report);

  console.log(`R2 uploads migration phase 1 (${report.mode})`);
  console.log(`Files: ${report.summary.totalFiles}`);
  console.log(`Referenced: ${report.summary.referencedFiles}`);
  console.log(`Unreferenced: ${report.summary.unreferencedFiles}`);
  console.log(`Planned: ${report.summary.planned}`);
  console.log(`Uploaded: ${report.summary.uploaded}`);
  console.log(`Already exists: ${report.summary.alreadyExists}`);
  console.log(`Failed: ${report.summary.failed}`);
  console.log(`Report JSON: ${reportPaths.json}`);
  console.log(`Report CSV: ${reportPaths.csv}`);

  if (report.summary.failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error.message || 'R2 uploads migration phase 1 failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
