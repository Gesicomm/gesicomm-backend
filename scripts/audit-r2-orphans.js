'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../src/models');
const { R2Service } = require('../src/services/r2/r2.service');
const { getR2Config, extractStorageKeyFromUrl } = require('../src/services/r2/r2.config');

const REPORTS_DIR = path.join(process.cwd(), 'reports', 'r2-orphans');

/**
 * Auditor de huérfanos de R2 — solo REPORTA, nunca borra en esta pasada.
 *
 * Compara todos los objetos que existen en el bucket contra todas las
 * referencias activas en PostgreSQL (columnas storage_key dedicadas +
 * URLs embebidas en content_json del armador de landing). Lo que sobra es
 * candidato a huérfano.
 *
 * No confía en "recién subido = huérfano": un objeto con menos de
 * MIN_AGE_HOURS de antigüedad se reporta aparte (`recent_skip`), porque
 * puede ser una imagen que el usuario subió pero todavía no guardó — el
 * mismo caso que describimos para content_json, generalizado a todos los
 * módulos por seguridad.
 *
 * builder_pages (og_imagen/favicon_url) queda afuera: es el módulo "Page
 * Builder" de funnels, confirmado código muerto por el usuario — sus
 * objetos en R2 (si los hay) van a aparecer como huérfanos, correctamente.
 *
 * Uso:
 *   node scripts/audit-r2-orphans.js                          # reporte (default, no borra nada)
 *   node scripts/audit-r2-orphans.js --min-age=48              # horas mínimas de antigüedad (default 24)
 *   node scripts/audit-r2-orphans.js --delete --older-than=30d # borra SOLO los candidatos con
 *                                                               # más de 30 días — paso deliberado
 *                                                               # y separado, nunca por defecto.
 */
const MIN_AGE_HOURS_DEFAULT = 24;

// Prefijos que efectivamente administra el proyecto (ver ImagenService /
// ComprobanteService). Cualquier otra cosa en el bucket se reporta aparte.
const KNOWN_PREFIXES = [
  'products/', 'landings/', 'offers/', 'testimonials/', 'sections/', 'receipts/', 'legacy/uploads/',
];
const IGNORED_PREFIXES = ['_system/'];

const SIMPLE_STORAGE_KEY_COLUMNS = [
  { table: 'producto_imagenes', column: 'storage_key' },
  { table: 'landings', column: 'banner_imagen_storage_key' },
  { table: 'landings', column: 'seo_og_imagen_storage_key' },
  { table: 'landings', column: 'logo_imagen_storage_key' },
  { table: 'ofertas_producto', column: 'imagen_storage_key' },
  { table: 'costos_gastos', column: 'comprobante_storage_key' },
];

// Sin columna storage_key dedicada: se deriva de la URL guardada.
const URL_DERIVED_COLUMNS = [
  { table: 'testimonios', column: 'foto' },
];

const JSON_COLUMNS = [
  { table: 'landings', column: 'content' },
];

function parseArgs(argv) {
  const minAgeArg = argv.find((a) => a.startsWith('--min-age='));
  const olderThanArg = argv.find((a) => a.startsWith('--older-than='));
  const olderThanDays = olderThanArg ? Number(olderThanArg.split('=')[1].replace(/d$/i, '')) : null;
  return {
    minAgeHours: minAgeArg ? Number(minAgeArg.split('=')[1]) : MIN_AGE_HOURS_DEFAULT,
    doDelete: argv.includes('--delete'),
    olderThanDays,
  };
}

function findR2KeysInValue(value, baseUrl, found) {
  if (typeof value === 'string') {
    if (baseUrl) {
      const prefix = `${baseUrl.replace(/\/+$/, '')}/`;
      const re = new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\s"\')]+', 'g');
      const matches = value.match(re) || [];
      matches.forEach((match) => found.add(match.slice(prefix.length)));
    }
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => findR2KeysInValue(item, baseUrl, found));
    return found;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => findR2KeysInValue(item, baseUrl, found));
  }
  return found;
}

async function collectReferencedKeys() {
  const referenced = new Set();
  const baseUrl = getR2Config().publicBaseUrl;

  for (const def of SIMPLE_STORAGE_KEY_COLUMNS) {
    const rows = await sequelize.query(
      `SELECT "${def.column}" AS value FROM "${def.table}" WHERE "${def.column}" IS NOT NULL`,
      { type: sequelize.QueryTypes.SELECT }
    );
    rows.forEach((row) => row.value && referenced.add(row.value));
  }

  for (const def of URL_DERIVED_COLUMNS) {
    const rows = await sequelize.query(
      `SELECT "${def.column}" AS value FROM "${def.table}" WHERE "${def.column}" IS NOT NULL`,
      { type: sequelize.QueryTypes.SELECT }
    );
    rows.forEach((row) => {
      const key = extractStorageKeyFromUrl(row.value);
      if (key) referenced.add(key);
    });
  }

  for (const def of JSON_COLUMNS) {
    const rows = await sequelize.query(
      `SELECT "${def.column}" AS value FROM "${def.table}" WHERE "${def.column}" IS NOT NULL`,
      { type: sequelize.QueryTypes.SELECT }
    );
    rows.forEach((row) => findR2KeysInValue(row.value, baseUrl, referenced));
  }

  return referenced;
}

async function listAllObjects() {
  const objects = [];
  for (const prefix of KNOWN_PREFIXES) {
    const items = await R2Service.listObjects(prefix);
    objects.push(...items);
  }
  return objects;
}

async function writeReport(report) {
  await fs.promises.mkdir(REPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const basePath = path.join(REPORTS_DIR, `audit-${stamp}`);

  await fs.promises.writeFile(`${basePath}.json`, JSON.stringify(report, null, 2));

  const csvLines = [
    'storage_key,size,last_modified,age_hours,status,reason',
    ...report.candidates.map((c) => [
      c.storageKey, c.size, c.lastModified, c.ageHours.toFixed(1), c.status, c.reason,
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
  ];
  await fs.promises.writeFile(`${basePath}.csv`, `${csvLines.join('\n')}\n`);

  return { json: `${basePath}.json`, csv: `${basePath}.csv` };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.doDelete && !options.olderThanDays) {
    throw new Error('--delete requiere --older-than=Nd (ej. --older-than=30d) — nunca se borra sin un umbral explícito.');
  }
  const startedAt = new Date().toISOString();
  const now = Date.now();

  const [objects, referencedKeys] = await Promise.all([listAllObjects(), collectReferencedKeys()]);

  const report = {
    startedAt,
    finishedAt: null,
    minAgeHours: options.minAgeHours,
    knownPrefixes: KNOWN_PREFIXES,
    summary: {
      totalObjects: objects.length,
      referencedKeysInDb: referencedKeys.size,
      orphanCandidates: 0,
      recentSkipped: 0,
      totalOrphanBytes: 0,
    },
    candidates: [],
  };

  for (const obj of objects) {
    const key = obj.Key;
    if (IGNORED_PREFIXES.some((p) => key.startsWith(p))) continue;
    if (referencedKeys.has(key)) continue;

    const ageHours = (now - new Date(obj.LastModified).getTime()) / 3600000;
    const item = {
      storageKey: key,
      size: obj.Size,
      lastModified: obj.LastModified,
      ageHours,
      status: ageHours >= options.minAgeHours ? 'orphan_candidate' : 'recent_skip',
      reason: 'no hay ninguna fila en PostgreSQL (columna storage_key ni content_json) que referencie esta key',
    };
    report.candidates.push(item);
    if (item.status === 'orphan_candidate') {
      report.summary.orphanCandidates++;
      report.summary.totalOrphanBytes += obj.Size;
    } else {
      report.summary.recentSkipped++;
    }
  }

  report.finishedAt = new Date().toISOString();

  if (options.doDelete) {
    report.deletion = { olderThanDays: options.olderThanDays, deleted: 0, failed: 0, errors: [] };
    for (const c of report.candidates) {
      if (c.status !== 'orphan_candidate') continue;
      if (c.ageHours / 24 < options.olderThanDays) continue;
      try {
        await R2Service.deleteObject(c.storageKey);
        c.status = 'deleted';
        report.deletion.deleted++;
      } catch (error) {
        c.status = 'delete_failed';
        report.deletion.failed++;
        report.deletion.errors.push({ storageKey: c.storageKey, error: error.message });
      }
    }
  }

  const paths = await writeReport(report);

  console.log(`Auditoría de huérfanos en R2 (${options.doDelete ? 'BORRADO' : 'solo reporte'})`);
  console.log(`Objetos en R2 (prefijos administrados): ${report.summary.totalObjects}`);
  console.log(`Keys referenciadas en PostgreSQL: ${report.summary.referencedKeysInDb}`);
  console.log(`Candidatos a huérfano (>= ${options.minAgeHours}h): ${report.summary.orphanCandidates}`);
  console.log(`Recientes, no candidatos todavía: ${report.summary.recentSkipped}`);
  console.log(`Peso total de candidatos: ${(report.summary.totalOrphanBytes / 1024 / 1024).toFixed(2)} MB`);
  if (report.deletion) {
    console.log(`Borrados (>= ${options.olderThanDays} días): ${report.deletion.deleted}`);
    console.log(`Fallidos: ${report.deletion.failed}`);
  } else {
    console.log('\nNo se borró nada — este script solo reporta salvo que se pase --delete --older-than=Nd.');
  }
  console.log(`Reporte JSON: ${paths.json}`);
  console.log(`Reporte CSV: ${paths.csv}`);
}

main()
  .catch((error) => {
    console.error(error.message || 'Auditoría de huérfanos falló');
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
