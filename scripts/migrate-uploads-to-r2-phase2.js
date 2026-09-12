'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../src/models');

const REPORTS_DIR = path.join(process.cwd(), 'reports', 'r2-migration');
const LEGACY_PREFIX = 'legacy/uploads';

/**
 * Fase 2 de la migración de /uploads a R2 (ver migrate-uploads-to-r2.js,
 * fase 1: sube los archivos físicos a R2 bajo legacy/uploads/ — ya corrida
 * y confirmada, 374/374 subidos). Esta fase reescribe las referencias en
 * PostgreSQL para que apunten al CDN en vez de a /uploads local.
 *
 * builder_pages (og_imagen/favicon_url) queda afuera a propósito: es el
 * módulo "Page Builder" de funnels, confirmado código muerto, no se toca.
 *
 * Columnas simples (string): url → CDN url, y si la tabla tiene columnas
 * hermanas de metadata (storage_key/mime_type/size), también se completan
 * — mismo criterio que graba ImagenService en una subida nueva. width/height
 * se dejan en null en el backfill (no crítico, no se usan para render).
 */
const SIMPLE_COLUMNS = [
  { table: 'producto_imagenes', idColumn: 'id', urlColumn: 'url', storageKeyColumn: 'storage_key', mimeColumn: 'mime_type', sizeColumn: 'size' },
  { table: 'landings', idColumn: 'id', urlColumn: 'banner_imagen', storageKeyColumn: 'banner_imagen_storage_key', mimeColumn: 'banner_imagen_mime_type', sizeColumn: 'banner_imagen_size' },
  { table: 'landings', idColumn: 'id', urlColumn: 'logo_imagen', storageKeyColumn: 'logo_imagen_storage_key', mimeColumn: 'logo_imagen_mime_type', sizeColumn: 'logo_imagen_size' },
  { table: 'landings', idColumn: 'id', urlColumn: 'seo_og_imagen', storageKeyColumn: 'seo_og_imagen_storage_key', mimeColumn: 'seo_og_imagen_mime_type', sizeColumn: 'seo_og_imagen_size' },
  { table: 'testimonios', idColumn: 'id', urlColumn: 'foto' },
  { table: 'ofertas_producto', idColumn: 'id', urlColumn: 'imagen_url', storageKeyColumn: 'imagen_storage_key', mimeColumn: 'imagen_mime_type', sizeColumn: 'imagen_size' },
  { table: 'costos_gastos', idColumn: 'id', urlColumn: 'comprobante_url', storageKeyColumn: 'comprobante_storage_key', mimeColumn: 'comprobante_mime_type', sizeColumn: 'comprobante_size' },
];

// content_json libre del page builder de landing (secciones) — la imagen
// puede estar en cualquier profundidad, se reescribe por texto, sin tracking
// de storage_key (no hay dónde guardarlo: no es una columna dedicada).
const JSON_COLUMNS = [
  { table: 'landings', idColumn: 'id', column: 'content' },
];

function parseArgs(argv) {
  const args = new Set(argv);
  return {
    commit: args.has('--commit'),
    dryRun: !args.has('--commit'),
  };
}

function latestPhase1Report() {
  if (!fs.existsSync(REPORTS_DIR)) throw new Error('No existe reports/r2-migration — corré primero la fase 1.');
  const files = fs.readdirSync(REPORTS_DIR).filter((f) => f.startsWith('phase1-') && f.endsWith('.json'));
  if (!files.length) throw new Error('No hay ningún reporte de fase 1 — corré primero migrate-uploads-to-r2.js --commit.');
  files.sort();
  return path.join(REPORTS_DIR, files[files.length - 1]);
}

function buildFileIndex(phase1ReportPath) {
  const report = JSON.parse(fs.readFileSync(phase1ReportPath, 'utf8'));
  const index = new Map();
  for (const file of report.files) {
    if (file.status !== 'uploaded' && file.status !== 'already_exists') continue;
    index.set(file.filename, {
      storageKey: file.storageKey || `${LEGACY_PREFIX}/${file.filename}`,
      cdnUrl: file.cdnUrl,
      contentType: file.contentType,
      size: file.size,
    });
  }
  return { index, reportPath: phase1ReportPath, mode: report.mode };
}

function filenameFromUploadsUrl(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/\/uploads\/([A-Za-z0-9._-]+)/);
  return match ? match[1] : null;
}

function replaceUploadsInJson(value, fileIndex, stats) {
  if (typeof value === 'string') {
    return value.replace(/\/uploads\/[A-Za-z0-9._-]+/g, (match) => {
      const filename = match.replace(/^\/uploads\/+/, '');
      const entry = fileIndex.get(filename);
      if (!entry) { stats.missing.add(filename); return match; }
      stats.replaced++;
      return entry.cdnUrl;
    });
  }
  if (Array.isArray(value)) return value.map((item) => replaceUploadsInJson(item, fileIndex, stats));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = replaceUploadsInJson(v, fileIndex, stats);
    return out;
  }
  return value;
}

async function migrateSimpleColumn(def, fileIndex, options, report) {
  const rows = await sequelize.query(
    `SELECT "${def.idColumn}" AS id, "${def.urlColumn}" AS value
     FROM "${def.table}"
     WHERE "${def.urlColumn}" LIKE '/uploads/%'`,
    { type: sequelize.QueryTypes.SELECT }
  );

  for (const row of rows) {
    const filename = filenameFromUploadsUrl(row.value);
    const entry = filename ? fileIndex.get(filename) : null;
    const item = {
      table: def.table, id: row.id, column: def.urlColumn,
      oldValue: row.value, newValue: null, status: null,
    };

    if (!entry) {
      item.status = 'missing_in_r2';
      report.items.push(item);
      report.summary.missing++;
      continue;
    }

    item.newValue = entry.cdnUrl;
    item.status = options.dryRun ? 'planned' : 'updated';
    report.items.push(item);
    options.dryRun ? report.summary.planned++ : report.summary.updated++;

    if (!options.dryRun) {
      const sets = [`"${def.urlColumn}" = :newUrl`];
      const replacements = { newUrl: entry.cdnUrl, id: row.id };
      if (def.storageKeyColumn) { sets.push(`"${def.storageKeyColumn}" = :storageKey`); replacements.storageKey = entry.storageKey; }
      if (def.mimeColumn) { sets.push(`"${def.mimeColumn}" = :mime`); replacements.mime = entry.contentType; }
      if (def.sizeColumn) { sets.push(`"${def.sizeColumn}" = :size`); replacements.size = entry.size; }
      await sequelize.query(
        `UPDATE "${def.table}" SET ${sets.join(', ')} WHERE "${def.idColumn}" = :id`,
        { replacements }
      );
    }
  }
}

async function migrateJsonColumn(def, fileIndex, options, report) {
  const rows = await sequelize.query(
    `SELECT "${def.idColumn}" AS id, "${def.column}" AS value
     FROM "${def.table}"
     WHERE "${def.column}" IS NOT NULL AND "${def.column}"::text LIKE '%/uploads/%'`,
    { type: sequelize.QueryTypes.SELECT }
  );

  for (const row of rows) {
    const stats = { replaced: 0, missing: new Set() };
    const newValue = replaceUploadsInJson(row.value, fileIndex, stats);
    const item = {
      table: def.table, id: row.id, column: def.column,
      replacedCount: stats.replaced, missing: [...stats.missing],
      status: null,
    };

    if (stats.missing.size) { report.summary.missing += stats.missing.size; }
    if (!stats.replaced) { item.status = 'no_change'; report.items.push(item); continue; }

    item.status = options.dryRun ? 'planned' : 'updated';
    report.items.push(item);
    options.dryRun ? report.summary.planned++ : report.summary.updated++;

    if (!options.dryRun) {
      await sequelize.query(
        `UPDATE "${def.table}" SET "${def.column}" = :newValue WHERE "${def.idColumn}" = :id`,
        { replacements: { newValue: JSON.stringify(newValue), id: row.id } }
      );
    }
  }
}

async function writeReport(report) {
  await fs.promises.mkdir(REPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const basePath = path.join(REPORTS_DIR, `phase2-${stamp}`);
  await fs.promises.writeFile(`${basePath}.json`, JSON.stringify(report, null, 2));
  return `${basePath}.json`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const phase1ReportPath = latestPhase1Report();
  const { index: fileIndex, mode: phase1Mode } = buildFileIndex(phase1ReportPath);

  if (phase1Mode !== 'commit') {
    throw new Error(`El último reporte de fase 1 (${phase1ReportPath}) fue en modo "${phase1Mode}", no "commit". Corré primero migrate-uploads-to-r2.js --commit.`);
  }

  const report = {
    phase: 2,
    mode: options.dryRun ? 'dry-run' : 'commit',
    destructive: false,
    phase1Report: phase1ReportPath,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    summary: { planned: 0, updated: 0, missing: 0 },
    items: [],
  };

  for (const def of SIMPLE_COLUMNS) {
    await migrateSimpleColumn(def, fileIndex, options, report);
  }
  for (const def of JSON_COLUMNS) {
    await migrateJsonColumn(def, fileIndex, options, report);
  }

  report.finishedAt = new Date().toISOString();
  const reportPath = await writeReport(report);

  console.log(`R2 uploads migration phase 2 (${report.mode})`);
  console.log(`Planned: ${report.summary.planned}`);
  console.log(`Updated: ${report.summary.updated}`);
  console.log(`Missing in R2 (no tocadas): ${report.summary.missing}`);
  console.log(`Report: ${reportPath}`);
}

main()
  .catch((error) => {
    console.error(error.message || 'R2 uploads migration phase 2 failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
