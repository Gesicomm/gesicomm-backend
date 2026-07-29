'use strict';

/**
 * Verifica que el motor de pricing del backend (fuente de verdad) y su
 * espejo del frontend (usado solo para UX local) produzcan exactamente
 * el mismo resultado ante los mismos inputs.
 *
 * comboPricingLocal.js (frontend) se mantiene a mano como copia de
 * comboPricing.js (backend). Este script es la red de seguridad contra
 * ese desincronizado manual: cualquier cambio de lógica en un motor que
 * no se replique en el otro rompe este chequeo.
 *
 * Uso: node scripts/verify-pricing-parity.js
 * (No requiere Jest ni transpilado: importa el .js del frontend con
 * dynamic import(), que Node resuelve como ESM nativo porque el
 * package.json de gesicomm-frontend declara "type": "module".)
 */

const path = require('path');

const backend = require('../src/utils/comboPricing');

const FRONTEND_MOTOR_PATH = path.join(
  __dirname,
  '..', '..', 'gesicomm-frontend', 'src', 'utils', 'comboPricingLocal.js',
);

const COSTS_DEFAULT = { cpaPercentage: 20, shipping: 5000, confirmation: 2000, packaging: 1000 };

// Escenarios cubiertos: los mismos casos límite de comboPricing.test.js,
// más el ejemplo numérico de la plantilla Excel original (SERUM/BALSAMO/BLANQUEADOR).
const ESCENARIOS = [
  {
    nombre: 'Sin upsells',
    input: {
      principal: { id: 1, name: 'Zapatilla Running', cost: 100000, salePrice: 250000 },
      upsells: [],
      costs: COSTS_DEFAULT,
      targetMargins: [15, 30, 45],
      minimumMargin: 10,
    },
  },
  {
    nombre: 'Con upsells (0% y 50% descuento)',
    input: {
      principal: { id: 1, name: 'Zapatilla Running', cost: 100000, salePrice: 250000 },
      upsells: [
        { id: 2, name: 'Medias', cost: 20000, salePrice: 50000, discountPercentage: 0 },
        { id: 3, name: 'Cordones', cost: 5000, salePrice: 15000, discountPercentage: 50 },
      ],
      costs: COSTS_DEFAULT,
      targetMargins: [15, 30, 45],
      minimumMargin: 10,
      excellentThreshold: 50,
      discountScenarios: [0, 5, 10, 15, 20, 25, 30, 35],
    },
  },
  {
    nombre: 'Descuento 100% en un upsell (borde)',
    input: {
      principal: { id: 1, name: 'Zapatilla Running', cost: 100000, salePrice: 250000 },
      upsells: [{ id: 4, name: 'Regalo', cost: 20000, salePrice: 50000, discountPercentage: 100 }],
      costs: COSTS_DEFAULT,
      minimumMargin: 10,
    },
  },
  {
    nombre: 'Precio principal = 0 (borde división por cero)',
    input: {
      principal: { id: 5, name: 'Gratis', cost: 10000, salePrice: 0 },
      upsells: [],
      costs: COSTS_DEFAULT,
      minimumMargin: 10,
    },
  },
  {
    nombre: 'Costo > precio (pérdida)',
    input: {
      principal: { id: 6, name: 'A pérdida', cost: 300000, salePrice: 250000 },
      upsells: [],
      costs: COSTS_DEFAULT,
      minimumMargin: 10,
    },
  },
  {
    nombre: 'Upsell a pérdida + margen de combo bajo (varios warnings a la vez)',
    input: {
      principal: { id: 7, name: 'Producto ajustado', cost: 90000, salePrice: 100000 },
      upsells: [{ id: 8, name: 'Accesorio caro', cost: 40000, salePrice: 30000, discountPercentage: 0 }],
      costs: COSTS_DEFAULT,
      minimumMargin: 10,
    },
  },
  {
    nombre: 'Ejemplo plantilla Excel (SERUM + BALSAMO + BLANQUEADOR)',
    input: {
      principal: { id: 10, name: 'SERUM', cost: 30000, salePrice: 229000 },
      upsells: [
        { id: 11, name: 'BALSAMO', cost: 23000, salePrice: 149000, discountPercentage: 50 },
        { id: 12, name: 'BLANQUEADOR', cost: 18000, salePrice: 149000, discountPercentage: 50 },
      ],
      costs: { cpaPercentage: 20, shipping: 25000, confirmation: 5000, packaging: 1500 },
      targetMargins: [15, 30, 45],
      minimumMargin: 15,
      excellentThreshold: 50,
    },
  },
];

function diffProfundo(a, b, prefix = '') {
  const diffs = [];
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return diffs;
    if (a !== b) diffs.push(`${prefix}: backend=${a} frontend=${b}`);
    return diffs;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    const len = Math.max(a?.length || 0, b?.length || 0);
    for (let i = 0; i < len; i++) diffs.push(...diffProfundo(a?.[i], b?.[i], `${prefix}[${i}]`));
    return diffs;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diffs.push(...diffProfundo(a[k], b[k], prefix ? `${prefix}.${k}` : k));
    return diffs;
  }
  if (a !== b) diffs.push(`${prefix}: backend=${JSON.stringify(a)} frontend=${JSON.stringify(b)}`);
  return diffs;
}

async function main() {
  const frontend = await import(`file://${FRONTEND_MOTOR_PATH.replace(/\\/g, '/')}`);

  let fallos = 0;

  for (const { nombre, input } of ESCENARIOS) {
    const resultadoBackend = backend.calcular(input);
    const resultadoFrontend = frontend.calcular(input);

    const diffs = diffProfundo(resultadoBackend, resultadoFrontend);

    if (diffs.length === 0) {
      console.log(`✅ ${nombre}`);
    } else {
      fallos++;
      console.error(`❌ ${nombre} — ${diffs.length} diferencia(s):`);
      diffs.forEach(d => console.error(`   ${d}`));
    }
  }

  if (fallos > 0) {
    console.error(`\n${fallos} escenario(s) con diferencias entre backend y frontend. Revisar sincronización de comboPricing.js / comboPricingLocal.js.`);
    process.exit(1);
  }

  console.log(`\nOK — ${ESCENARIOS.length} escenarios idénticos entre backend y frontend.`);
}

main().catch(err => {
  console.error('Error ejecutando la verificación de paridad:', err);
  process.exit(1);
});
