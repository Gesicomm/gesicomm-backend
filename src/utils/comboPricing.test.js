'use strict';

/**
 * Tests unitarios del motor de cálculo de rentabilidad de combos.
 * No requieren DB, Express ni mocks. Motor puro.
 *
 * Ejecutar con: npx jest src/utils/comboPricing.test.js --verbose
 */

const {
  calcular,
  calcularPrincipal,
  calcularUpsell,
  calcularCombo,
  calcularComparativa,
  clasificarOferta,
  clasificarRentabilidad,
  calcularRecomendaciones,
  calcularPrecioMinimo,
  calcularDescuentoMaximo,
  calcularSensibilidad,
  utilidadAPrecio,
} = require('./comboPricing');

// ─── Fixtures comunes ─────────────────────────────────────────────────────────

const COSTS_DEFAULT = {
  cpaPercentage: 20,   // 20%
  shipping: 5000,
  confirmation: 2000,
  packaging: 1000,
};

const PRINCIPAL = {
  id: 1,
  name: 'Zapatilla Running',
  cost: 100000,
  salePrice: 250000,
};

// ─── Caso 1 — Producto principal sin Upsells ──────────────────────────────────

describe('Caso 1 — Producto sin upsells', () => {
  let result;

  beforeAll(() => {
    result = calcular({
      principal: PRINCIPAL,
      upsells: [],
      costs: COSTS_DEFAULT,
      targetMargins: [15, 30, 45],
      minimumMargin: 10,
    });
  });

  test('calcula correctamente aunque no haya upsells', () => {
    expect(result.upsells).toHaveLength(0);
  });

  test('CPA máximo = precioVenta * cpaPercentage / 100', () => {
    // 250.000 * 20% = 50.000
    expect(result.principal.cpaMax).toBe(50000);
  });

  test('costos totales del principal incluyen todos los componentes', () => {
    // 100.000 + 50.000 + 5.000 + 2.000 + 1.000 = 158.000
    expect(result.principal.totalCosts).toBe(158000);
  });

  test('incluye comisión de cobro cuando viene configurada', () => {
    const r = calcular({
      principal: PRINCIPAL,
      upsells: [],
      costs: { ...COSTS_DEFAULT, paymentCommissionPercentage: 5 },
      targetMargins: [15, 30, 45],
      minimumMargin: 10,
    });
    expect(r.principal.paymentCommissionCost).toBe(12500);
    expect(r.principal.totalCosts).toBe(170500);
    expect(r.combo.totalCost).toBe(170500);
  });

  test('utilidad = precioVenta - costosTotales', () => {
    // 250.000 - 158.000 = 92.000
    expect(result.principal.profit).toBe(92000);
  });

  test('margen = utilidad / precioVenta', () => {
    // 92.000 / 250.000 = 0.368
    expect(result.principal.margin).toBeCloseTo(0.368, 3);
  });

  test('precio combo = precio principal (sin upsells)', () => {
    expect(result.combo.finalPrice).toBe(250000);
  });

  test('no produce NaN ni Infinity', () => {
    expect(result.principal.margin).not.toBeNaN();
    expect(result.principal.margin).not.toBe(Infinity);
    expect(result.combo.margin).not.toBeNaN();
  });
});

// ─── Caso 2 — Un Upsell sin descuento (0%) ───────────────────────────────────

describe('Caso 2 — Upsell con descuento 0%', () => {
  const UPSELL = { id: 2, name: 'Medias', cost: 20000, salePrice: 50000, discountPercentage: 0 };

  test('precio final del upsell = precio original', () => {
    const r = calcularUpsell(UPSELL);
    expect(r.finalPrice).toBe(50000);
    expect(r.discountAmount).toBe(0);
  });

  test('utilidad = precioFinal - costo', () => {
    const r = calcularUpsell(UPSELL);
    expect(r.profit).toBe(30000);
  });

  test('margen = utilidad / precioFinal', () => {
    const r = calcularUpsell(UPSELL);
    expect(r.margin).toBeCloseTo(0.6, 3);
  });
});

// ─── Caso 3 — Upsell con 50% de descuento ────────────────────────────────────

describe('Caso 3 — Upsell con 50% de descuento', () => {
  const UPSELL = { id: 3, name: 'Medias 50%', cost: 20000, salePrice: 50000, discountPercentage: 50 };

  let r;
  beforeAll(() => { r = calcularUpsell(UPSELL); });

  test('monto descuento = precio * 50%', () => {
    expect(r.discountAmount).toBe(25000);
  });

  test('precio final = precio * (1 - 0.50)', () => {
    expect(r.finalPrice).toBe(25000);
  });

  test('utilidad = precioFinal - costo', () => {
    // 25.000 - 20.000 = 5.000
    expect(r.profit).toBe(5000);
  });

  test('margen = utilidad / precioFinal', () => {
    // 5.000 / 25.000 = 0.20
    expect(r.margin).toBeCloseTo(0.2, 3);
  });
});

// ─── Caso 4 — Descuento 100% ─────────────────────────────────────────────────

describe('Caso 4 — Descuento 100%', () => {
  const UPSELL = { id: 4, name: 'Regalo', cost: 20000, salePrice: 50000, discountPercentage: 100 };

  let r;
  beforeAll(() => { r = calcularUpsell(UPSELL); });

  test('precio final = 0', () => {
    expect(r.finalPrice).toBe(0);
  });

  test('margen = 0 (sin división por cero)', () => {
    expect(r.margin).toBe(0);
  });

  test('no produce NaN ni Infinity', () => {
    expect(r.margin).not.toBeNaN();
    expect(r.margin).not.toBe(Infinity);
  });
});

// ─── Caso 5 — Precio principal = 0 ───────────────────────────────────────────

describe('Caso 5 — Precio principal = 0', () => {
  const PRINCIPAL_ZERO = { id: 5, name: 'Gratis', cost: 10000, salePrice: 0 };

  test('no produce NaN ni Infinity en ningún campo', () => {
    const r = calcular({
      principal: PRINCIPAL_ZERO,
      upsells: [],
      costs: COSTS_DEFAULT,
      targetMargins: [30],
      minimumMargin: 10,
    });
    expect(r.principal.cpaMax).toBe(0);
    expect(r.principal.margin).not.toBeNaN();
    expect(r.principal.margin).not.toBe(Infinity);
    expect(r.combo.margin).not.toBeNaN();
    expect(r.combo.margin).not.toBe(Infinity);
  });
});

// ─── Caso 6 — Costo superior al precio ───────────────────────────────────────

describe('Caso 6 — Costo > precio', () => {
  const PRINCIPAL_LOSS = { id: 6, name: 'A pérdida', cost: 300000, salePrice: 250000 };

  let result;
  beforeAll(() => {
    result = calcular({
      principal: PRINCIPAL_LOSS,
      upsells: [],
      costs: COSTS_DEFAULT,
      targetMargins: [30],
      minimumMargin: 10,
    });
  });

  test('utilidad es negativa', () => {
    expect(result.principal.profit).toBeLessThan(0);
  });

  test('margen es negativo', () => {
    expect(result.principal.margin).toBeLessThan(0);
  });

  test('clasificación de rentabilidad es NO_RENTABLE', () => {
    expect(result.comparison.profitabilityStatus).toBe('NO_RENTABLE');
  });

  test('combo también no rentable', () => {
    expect(result.combo.profit).toBeLessThan(0);
  });
});

// ─── Caso 7 — Utilidad individual = 0 ────────────────────────────────────────

describe('Caso 7 — Utilidad solo = 0', () => {
  // Principal cuyo precio = costos exactos
  // CPA(20%) + envío + confirmación + empaque = 8.000; costo = 250.000 - 8.000 = 242.000
  // Para utilidad = 0: precio = totalCosts
  // precio = 250.000, CPA=50.000, costos extra=8.000, total=358.000
  // usamos precio = totalCosts directamente:
  const PRINCIPAL_ZERO_PROFIT = {
    id: 7, name: 'Equilibrio', cost: 0, salePrice: 8000,
    // Con CPA 20%: cpaMax = 1600; total = 1600+5000+2000+1000 = 9600 → utilidad = 8000-9600 = -1600
    // Ajustamos para que utilidad = 0: salePrice = totalCosts
    // totalCosts = cost + salePrice*0.20 + 5000+2000+1000
    // Si cost=0: totalCosts = 0.20*P + 8000 → P - (0.20*P + 8000) = 0 → 0.80P = 8000 → P = 10000
  };

  // Recalcular con P=10000: CPA=2000, total=0+2000+5000+2000+1000=10000, utilidad=10000-10000=0
  const PRINCIPAL_EXACT = { id: 7, name: 'Equilibrio', cost: 0, salePrice: 10000 };

  test('profitDifferencePercentage es null cuando utilidad solo = 0', () => {
    const r = calcular({
      principal: PRINCIPAL_EXACT,
      upsells: [],
      costs: COSTS_DEFAULT,
      targetMargins: [30],
      minimumMargin: 10,
    });
    // Si utilidad solo = 0, la diferencia porcentual es null
    expect(r.principal.profit).toBe(0);
    expect(r.comparison.profitDifferencePercentage).toBeNull();
  });
});

// ─── Caso 8 — Múltiples Upsells ──────────────────────────────────────────────

describe('Caso 8 — Múltiples Upsells', () => {
  const UPSELLS = [
    { id: 10, name: 'Medias', cost: 20000, salePrice: 50000, discountPercentage: 20 },
    { id: 11, name: 'Gel', cost: 15000, salePrice: 30000, discountPercentage: 50 },
    { id: 12, name: 'Mochila', cost: 50000, salePrice: 100000, discountPercentage: 10 },
  ];

  let result;
  beforeAll(() => {
    result = calcular({
      principal: PRINCIPAL,
      upsells: UPSELLS,
      costs: COSTS_DEFAULT,
      targetMargins: [15, 30, 45],
      minimumMargin: 10,
    });
  });

  test('precio original combo = precio principal + suma de precios originales de upsells', () => {
    // 250.000 + 50.000 + 30.000 + 100.000 = 430.000
    expect(result.combo.originalPrice).toBe(430000);
  });

  test('precio final combo = precio principal + suma de precios finales de upsells', () => {
    // Upsell 1: 50.000 * 0.80 = 40.000
    // Upsell 2: 30.000 * 0.50 = 15.000
    // Upsell 3: 100.000 * 0.90 = 90.000
    // 250.000 + 40.000 + 15.000 + 90.000 = 395.000
    expect(result.combo.finalPrice).toBe(395000);
  });

  test('descuento monetario = precioOriginal - precioFinal', () => {
    // 430.000 - 395.000 = 35.000
    expect(result.combo.discountAmount).toBe(35000);
  });

  test('costo upsells = suma de costos de todos los upsells', () => {
    // 20.000 + 15.000 + 50.000 = 85.000
    expect(result.combo.upsellCosts).toBe(85000);
  });

  test('CPA se cobra sobre el precio del combo, no solo sobre el principal', () => {
    // 395.000 * 20% = 79.000
    expect(result.combo.cpa).toBe(79000);
  });

  test('costo total combo = productos + logística + CPA del combo', () => {
    // productos = 100.000 + 85.000 = 185.000; logística = 8.000 → fijo 193.000
    // CPA = 79.000 → total = 272.000
    expect(result.combo.fixedCost).toBe(193000);
    expect(result.combo.variableRate).toBeCloseTo(0.2, 6);
    expect(result.combo.totalCost).toBe(272000);
  });

  test('utilidad combo = precioFinal - costoTotal', () => {
    // 395.000 - 272.000 = 123.000
    expect(result.combo.profit).toBe(123000);
  });

  test('margen combo = utilidad / precioFinal', () => {
    // 123.000 / 395.000 ≈ 0.3114
    expect(result.combo.margin).toBeCloseTo(0.3114, 3);
  });

  test('la comisión de cobro también va sobre el combo entero', () => {
    const r = calcular({ principal: PRINCIPAL, upsells: UPSELLS, costs: { ...COSTS_DEFAULT, paymentCommissionPercentage: 5 } });
    // 395.000 * 5% = 19.750
    expect(r.combo.paymentCommissionCost).toBe(19750);
    expect(r.combo.totalCost).toBe(291750);
  });

  test('la sensibilidad recalcula CPA sobre cada precio con descuento', () => {
    const fila = result.sensitivity.find(s => s.discountPercentage === 10);
    // precio 355.500 → utilidad = 355.500 - 193.000 - 71.100 = 91.400
    expect(fila.price).toBe(355500);
    expect(fila.profit).toBe(91400);
  });

  test('precio mínimo y recomendados cubren el CPA que cobra ese mismo precio', () => {
    // equilibrio = 193.000 / 0.8 = 241.250
    expect(result.minimumPrice).toBe(241250);
    expect(utilidadAPrecio(result.minimumPrice, result.combo)).toBe(0);
    const rec30 = result.recommendations.find(r => r.targetMargin === 30);
    expect(rec30.suggestedPrice).toBe(386000); // 193.000 / 0.5
    expect(rec30.estimatedProfit / rec30.suggestedPrice).toBeCloseTo(0.30, 6);
  });

  test('retorna 3 upsells calculados', () => {
    expect(result.upsells).toHaveLength(3);
  });
});

// ─── Caso 9 — Precios recomendados por margen objetivo ───────────────────────

describe('Caso 9 — Precios recomendados', () => {
  const TOTAL_COST = 150000;
  const COMBO = { fixedCost: TOTAL_COST, variableRate: 0 };

  test('precio para 15% = costo / (1 - 0.15)', () => {
    const recs = calcularRecomendaciones(COMBO, [15]);
    expect(recs[0].suggestedPrice).toBeCloseTo(150000 / 0.85, 0);
  });

  test('precio para 30% = costo / (1 - 0.30)', () => {
    const recs = calcularRecomendaciones(COMBO, [30]);
    expect(recs[0].suggestedPrice).toBeCloseTo(150000 / 0.70, 0);
  });

  test('precio para 45% = costo / (1 - 0.45)', () => {
    const recs = calcularRecomendaciones(COMBO, [45]);
    expect(recs[0].suggestedPrice).toBeCloseTo(150000 / 0.55, 0);
  });

  test('utilidad estimada = precio sugerido - costo', () => {
    const recs = calcularRecomendaciones(COMBO, [30]);
    expect(recs[0].estimatedProfit).toBeCloseTo(recs[0].suggestedPrice - TOTAL_COST, 0);
  });
});

// ─── Caso 10 — Precio mínimo = costo total ───────────────────────────────────

describe('Caso 10 — Precio mínimo (punto de equilibrio)', () => {
  test('precio mínimo = costo total (equilibrio exacto)', () => {
    const totalCost = 200000;
    const minPrice = calcularPrecioMinimo({ fixedCost: totalCost, variableRate: 0 });
    expect(minPrice).toBe(totalCost);
  });

  test('precio < costo → pérdida (verificación conceptual)', () => {
    const totalCost = 200000;
    const minPrice = calcularPrecioMinimo({ fixedCost: totalCost, variableRate: 0 });
    expect(minPrice - 1 < totalCost).toBe(true);
  });
});

// ─── Caso 11 — Descuento máximo respeta margen mínimo ────────────────────────

describe('Caso 11 — Descuento máximo permitido', () => {
  const TOTAL_COST = 150000;
  const ORIGINAL_PRICE = 300000;
  const MINIMUM_MARGIN = 10; // 10%
  const COMBO = { fixedCost: TOTAL_COST, variableRate: 0 };

  test('descuento máximo respeta el margen mínimo configurado', () => {
    const maxDiscount = calcularDescuentoMaximo(COMBO, ORIGINAL_PRICE, MINIMUM_MARGIN);
    // Precio mínimo = 150.000 / (1 - 0.10) = 166.666...
    // Desc max = 1 - (166.666 / 300.000) = 1 - 0.5555 = 0.4444 = 44.44%
    expect(maxDiscount).toBeCloseTo(44.44, 1);
  });

  test('precio con descuento máximo tiene exactamente el margen mínimo', () => {
    const maxDiscount = calcularDescuentoMaximo(COMBO, ORIGINAL_PRICE, MINIMUM_MARGIN);
    const finalPrice = ORIGINAL_PRICE * (1 - maxDiscount / 100);
    const margin = (finalPrice - TOTAL_COST) / finalPrice;
    expect(margin).toBeCloseTo(MINIMUM_MARGIN / 100, 2);
  });

  test('retorna null si no hay margen para ningún descuento', () => {
    // Costo > precio original → imposible descontar
    const result = calcularDescuentoMaximo({ fixedCost: 400000, variableRate: 0 }, 300000, 10);
    expect(result).toBeNull();
  });

  test('con CPA, el descuento máximo deja el margen mínimo después de publicidad', () => {
    const combo = { fixedCost: 150000, variableRate: 0.2 };
    const maxDiscount = calcularDescuentoMaximo(combo, ORIGINAL_PRICE, MINIMUM_MARGIN);
    const precio = ORIGINAL_PRICE * (1 - maxDiscount / 100);
    expect(utilidadAPrecio(precio, combo) / precio).toBeCloseTo(MINIMUM_MARGIN / 100, 3);
  });

  test('retorna null si precio original es 0', () => {
    const result = calcularDescuentoMaximo({ fixedCost: 150000, variableRate: 0 }, 0, 10);
    expect(result).toBeNull();
  });
});

// ─── Caso extra — Clasificaciones ────────────────────────────────────────────

describe('Clasificaciones de oferta y rentabilidad', () => {
  test('EXCELENTE: diferencia > umbral (50)', () => {
    expect(clasificarOferta(75, 50)).toBe('EXCELENTE');
  });

  test('BUENA: 0 < diferencia <= umbral', () => {
    expect(clasificarOferta(30, 50)).toBe('BUENA');
    expect(clasificarOferta(50, 50)).toBe('BUENA');
  });

  test('REVISAR: diferencia <= 0', () => {
    expect(clasificarOferta(0, 50)).toBe('REVISAR');
    expect(clasificarOferta(-10, 50)).toBe('REVISAR');
  });

  test('REVISAR: diferencia es null', () => {
    expect(clasificarOferta(null, 50)).toBe('REVISAR');
  });

  test('SALUDABLE: margen >= minimo', () => {
    expect(clasificarRentabilidad(0.30, 0.10)).toBe('SALUDABLE');
    expect(clasificarRentabilidad(0.10, 0.10)).toBe('SALUDABLE');
  });

  test('MARGEN_BAJO: 0 < margen < minimo', () => {
    expect(clasificarRentabilidad(0.05, 0.10)).toBe('MARGEN_BAJO');
  });

  test('NO_RENTABLE: margen <= 0', () => {
    expect(clasificarRentabilidad(0, 0.10)).toBe('NO_RENTABLE');
    expect(clasificarRentabilidad(-0.05, 0.10)).toBe('NO_RENTABLE');
  });
});
