/**
 * Motor de cálculo de rentabilidad de combos.
 *
 * PRINCIPIOS:
 * - Función pura y determinista: mismo input → mismo output.
 * - Sin dependencias de DB, Express, React ni efectos colaterales.
 * - Recibe datos ya resueltos desde combo.service.js vía DTOs normalizados.
 * - Nunca produce NaN ni Infinity. División por cero → 0 o null.
 * - Sin redondeo en cálculos intermedios. Redondeo solo en output final.
 * - warnings[]: array de strings con advertencias (margen bajo, stock, etc.)
 *
 * FLUJO RECOMENDADO:
 *   DB → combo.service.js → toMotorInput() → comboPricing.calcular() → resultado
 *
 * @module comboPricing
 */

'use strict';

// ─── Helpers internos ─────────────────────────────────────────────────────────

/** División segura. Retorna 0 si el divisor es 0. */
function div(numerador, denominador) {
  if (!denominador || denominador === 0) return 0;
  return numerador / denominador;
}

/** División segura para diferencias porcentuales. Retorna null si el divisor es 0. */
function divNullable(numerador, denominador) {
  if (!denominador || denominador === 0) return null;
  return numerador / denominador;
}

/** Redondea a 2 decimales (valores monetarios). */
function r2(n) {
  return Math.round((n || 0) * 100) / 100;
}

/** Redondea a 4 decimales (márgenes como fracción decimal). */
function r4(n) {
  return Math.round((n || 0) * 10000) / 10000;
}

// ─── Cálculos del Producto Principal ─────────────────────────────────────────

/**
 * Calcula rentabilidad del producto principal.
 *
 * @param {{ id, name, cost, salePrice }} principal
 * @param {{ cpaPercentage, shipping, confirmation, packaging }} costs
 * @returns {{ cpaMax, totalCosts, profit, margin, discountSimulation }}
 */
function calcularPrincipal(principal, costs) {
  const costo = principal.cost || 0;
  const precio = principal.salePrice || 0;

  const cpaMax = r2(precio * (costs.cpaPercentage / 100));
  const totalCosts = r2(costo + cpaMax + costs.shipping + costs.confirmation + costs.packaging);
  const profit = r2(precio - totalCosts);
  const margin = r4(div(profit, precio));

  return { cpaMax, totalCosts, profit, margin };
}

/**
 * Simula distintos descuentos sobre el precio del producto principal.
 * Es analítico — no modifica precio_total del combo.
 *
 * @param {number} salePrice
 * @param {number} totalCosts
 * @param {number[]} scenarios - Array de porcentajes (ej: [0,10,20,30,40])
 * @returns {Array<{ discountPercentage, finalPrice, profit, margin }>}
 */
function simularDescuentosPrincipal(salePrice, totalCosts, scenarios = [0, 10, 20, 30, 40]) {
  return scenarios.map(pct => {
    const finalPrice = r2(salePrice * (1 - pct / 100));
    const profit = r2(finalPrice - totalCosts);
    const margin = r4(div(profit, finalPrice));
    return { discountPercentage: pct, finalPrice, profit, margin };
  });
}

// ─── Cálculos de Upsells ──────────────────────────────────────────────────────

/**
 * Calcula rentabilidad de un upsell individual.
 *
 * @param {{ id, name, cost, salePrice, discountPercentage }} upsell
 * @returns {{ productId, originalPrice, cost, discountAmount, discountPercentage, finalPrice, profit, margin }}
 */
function calcularUpsell(upsell) {
  const precio = upsell.salePrice || 0;
  const costo = upsell.cost || 0;
  const descPct = upsell.discountPercentage || 0;

  const discountAmount = r2(precio * (descPct / 100));
  const finalPrice = r2(precio * (1 - descPct / 100));
  const profit = r2(finalPrice - costo);
  const margin = r4(div(profit, finalPrice));

  return {
    productId: upsell.id,
    originalPrice: r2(precio),
    cost: r2(costo),
    discountAmount,
    discountPercentage: descPct,
    finalPrice,
    profit,
    margin,
  };
}

// ─── Cálculos del Combo ───────────────────────────────────────────────────────

/**
 * Calcula precios y costos del combo completo.
 *
 * @param {{ salePrice }} principal
 * @param {Array} upsellResults - Resultado de calcularUpsell() para cada upsell
 * @param {number} principalTotalCosts - costoTotal del producto principal (incluye CPA, envío, etc.)
 * @returns {{ originalPrice, finalPrice, discountAmount, discountPercentage, upsellCosts, totalCost, profit, margin, ticket }}
 */
function calcularCombo(principal, upsellResults, principalTotalCosts) {
  const precioOriginalPrincipal = principal.salePrice || 0;

  const sumaOriginalUpsells = upsellResults.reduce((acc, u) => acc + u.originalPrice, 0);
  const sumaFinalUpsells = upsellResults.reduce((acc, u) => acc + u.finalPrice, 0);
  const sumaCostosUpsells = upsellResults.reduce((acc, u) => acc + u.cost, 0);

  const originalPrice = r2(precioOriginalPrincipal + sumaOriginalUpsells);
  const finalPrice = r2(precioOriginalPrincipal + sumaFinalUpsells);
  const discountAmount = r2(originalPrice - finalPrice);
  const discountPercentage = r4(div(discountAmount, originalPrice));

  const upsellCosts = r2(sumaCostosUpsells);
  const totalCost = r2(principalTotalCosts + upsellCosts);
  const profit = r2(finalPrice - totalCost);
  const margin = r4(div(profit, finalPrice));

  return {
    originalPrice,
    finalPrice,
    discountAmount,
    discountPercentage,
    upsellCosts,
    totalCost,
    profit,
    margin,
    ticket: finalPrice, // Alias semántico para claridad en UI
  };
}

// ─── Comparativa Solo vs Combo ────────────────────────────────────────────────

/**
 * Compara la utilidad de vender el producto solo vs en combo.
 *
 * Si utilidad_solo es 0 o negativa, profitDifferencePercentage es null
 * para evitar resultados matemáticamente válidos pero comercialmente engañosos.
 *
 * @param {number} standaloneProfit - Utilidad del producto principal sin combo
 * @param {number} comboProfit - Utilidad del combo completo
 * @param {number} excellentThreshold - % de incremento para clasificar como Excelente
 * @param {number} minimumMargin - % de margen mínimo para advertencia (como fracción, ej: 0.10)
 * @param {number} comboMargin - Margen del combo como fracción decimal
 * @returns {{ standaloneProfit, comboProfit, profitDifference, profitDifferencePercentage, offerStatus, profitabilityStatus }}
 */
function calcularComparativa(standaloneProfit, comboProfit, excellentThreshold = 50, minimumMargin = 0.10, comboMargin = 0) {
  const profitDifference = r2(comboProfit - standaloneProfit);

  // Si utilidad solo es <= 0, el porcentaje es matemáticamente válido pero comercialmente engañoso.
  const profitDifferencePercentage = standaloneProfit > 0
    ? r4(divNullable(profitDifference, standaloneProfit) * 100)
    : null;

  const offerStatus = clasificarOferta(profitDifferencePercentage, excellentThreshold);
  const profitabilityStatus = clasificarRentabilidad(comboMargin, minimumMargin);

  return {
    standaloneProfit: r2(standaloneProfit),
    comboProfit: r2(comboProfit),
    profitDifference,
    profitDifferencePercentage,
    offerStatus,
    profitabilityStatus,
  };
}

// ─── Clasificaciones ──────────────────────────────────────────────────────────

/**
 * Clasifica la calidad de la oferta según el incremento de utilidad.
 *
 * @param {number|null} diffPercentage - Diferencia porcentual (puede ser null)
 * @param {number} excellentThreshold - Umbral para "Excelente" (default 50%)
 * @returns {'EXCELENTE'|'BUENA'|'REVISAR'}
 */
function clasificarOferta(diffPercentage, excellentThreshold = 50) {
  if (diffPercentage === null || diffPercentage === undefined) return 'REVISAR';
  if (diffPercentage > excellentThreshold) return 'EXCELENTE';
  if (diffPercentage > 0) return 'BUENA';
  return 'REVISAR';
}

/**
 * Clasifica la rentabilidad absoluta del combo.
 *
 * margen_minimo es un umbral de ADVERTENCIA, no de bloqueo.
 *
 * @param {number} margin - Margen como fracción decimal (ej: 0.30 = 30%)
 * @param {number} minimumMargin - Umbral de advertencia como fracción decimal (ej: 0.10 = 10%)
 * @returns {'SALUDABLE'|'MARGEN_BAJO'|'NO_RENTABLE'}
 */
function clasificarRentabilidad(margin, minimumMargin = 0.10) {
  if (margin <= 0) return 'NO_RENTABLE';
  if (margin < minimumMargin) return 'MARGEN_BAJO';
  return 'SALUDABLE';
}

/**
 * Metadata de presentación para cada valor que puede devolver
 * clasificarRentabilidad(). Única fuente de verdad: cualquier consumidor
 * (admin, vitrina del usuario, futuros clientes de la API) debe leer la
 * etiqueta/severidad desde acá — nunca reimplementar el mapeo enum→texto
 * en la capa de presentación, para no repetir el drift que ya sufrió
 * calcularSensibilidad() entre el backend y su espejo de frontend.
 *
 * `severity` además funciona como nombre de clase CSS (saludable |
 * margen-bajo | no-rentable), así el frontend no necesita su propio
 * diccionario de traducción.
 */
const RENTABILIDAD_META = {
  SALUDABLE: { label: 'Saludable', severity: 'saludable' },
  MARGEN_BAJO: { label: 'Margen bajo', severity: 'margen-bajo' },
  NO_RENTABLE: { label: 'No rentable', severity: 'no-rentable' },
};

// ─── Recomendaciones de precio ────────────────────────────────────────────────

/**
 * Calcula precios sugeridos para alcanzar distintos márgenes objetivo.
 *
 * Fórmula: precio_sugerido = costo_total / (1 - margen_objetivo)
 *
 * @param {number} totalCost - Costo total del combo
 * @param {number[]} targetMargins - Array de porcentajes (ej: [15, 30, 45])
 * @returns {Array<{ targetMargin, suggestedPrice, estimatedProfit }>}
 */
function calcularRecomendaciones(totalCost, targetMargins = [15, 30, 45]) {
  return targetMargins.map(marginPct => {
    const marginDecimal = marginPct / 100;
    // Si margen objetivo >= 100%, no hay precio posible
    const suggestedPrice = marginDecimal < 1 ? r2(totalCost / (1 - marginDecimal)) : null;
    const estimatedProfit = suggestedPrice !== null ? r2(suggestedPrice - totalCost) : null;
    return { targetMargin: marginPct, suggestedPrice, estimatedProfit };
  });
}

// ─── Precio mínimo y descuento máximo ────────────────────────────────────────

/**
 * El precio mínimo rentable es el punto de equilibrio:
 * precio < costo → pérdida
 * precio = costo → equilibrio (margen 0)
 * precio > costo → ganancia
 *
 * @param {number} totalCost
 * @returns {number}
 */
function calcularPrecioMinimo(totalCost) {
  return r2(totalCost);
}

/**
 * Descuento máximo permitido manteniendo el margen mínimo configurado.
 * Retorna null si no existe margen disponible para ningún descuento.
 *
 * @param {number} totalCost - Costo total del combo
 * @param {number} originalPrice - Precio original del combo (sin descuentos de upsells)
 * @param {number} minimumMarginPct - Margen mínimo deseado en porcentaje (ej: 10)
 * @returns {number|null} - Porcentaje de descuento máximo (0-100) o null
 */
function calcularDescuentoMaximo(totalCost, originalPrice, minimumMarginPct = 10) {
  if (!originalPrice || originalPrice === 0) return null;
  const minimumMarginDecimal = minimumMarginPct / 100;
  if (minimumMarginDecimal >= 1) return null;

  const precioMinimoPermitido = r2(totalCost / (1 - minimumMarginDecimal));
  const descuentoMaximo = r4(1 - div(precioMinimoPermitido, originalPrice));

  // Si es negativo, el precio mínimo ya supera el precio original → sin margen para descuentos
  if (descuentoMaximo < 0) return null;

  return r4(descuentoMaximo * 100); // Retorna como porcentaje
}

// ─── Análisis de sensibilidad ─────────────────────────────────────────────────

/**
 * Genera tabla de escenarios con distintos descuentos aplicados al precio del combo.
 *
 * @param {{ finalPrice: number, totalCost: number }} comboData
 * @param {number[]} scenarios - Porcentajes de descuento a simular
 * @param {{ minimumMargin: number }} thresholds
 * @returns {Array<{ discountPercentage, price, profit, margin, status }>}
 */
function calcularSensibilidad(comboData, scenarios = [0, 5, 10, 15, 20, 25, 30, 35], thresholds = { minimumMargin: 0.10 }) {
  return scenarios.map(descPct => {
    const price = r2(comboData.finalPrice * (1 - descPct / 100));
    const profit = r2(price - comboData.totalCost);
    const margin = r4(div(profit, price));
    const status = clasificarRentabilidad(margin, thresholds.minimumMargin);
    return { discountPercentage: descPct, price, profit, margin, status };
  });
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Ejecuta el cálculo completo de rentabilidad de un combo.
 *
 * @param {object} input
 * @param {{ id, name, cost, salePrice }} input.principal
 * @param {Array<{ id, name, cost, salePrice, discountPercentage }>} input.upsells
 * @param {{ cpaPercentage, shipping, confirmation, packaging }} input.costs
 * @param {number[]} input.targetMargins
 * @param {number} input.minimumMargin - En porcentaje (ej: 10)
 * @param {number} input.excellentThreshold - En porcentaje (ej: 50)
 * @param {number[]} input.discountScenarios
 * @returns {object} ComboPricingResult
 */
function calcular(input) {
  const {
    principal,
    upsells = [],
    costs = { cpaPercentage: 20, shipping: 0, confirmation: 0, packaging: 0 },
    targetMargins = [15, 30, 45],
    minimumMargin = 10,
    excellentThreshold = 50,
    discountScenarios = [0, 5, 10, 15, 20, 25, 30, 35],
  } = input;

  const warnings = [];

  // 1. Producto principal
  const principalResult = calcularPrincipal(principal, costs);
  const discountSimulation = simularDescuentosPrincipal(
    principal.salePrice,
    principalResult.totalCosts,
    [0, 10, 20, 30, 40],
  );

  // 2. Upsells individuales
  const upsellResults = upsells.map(u => calcularUpsell(u));

  // Advertencias por upsells sin rentabilidad
  upsellResults.forEach((u, i) => {
    if (u.profit < 0) {
      warnings.push(`El upsell "${upsells[i].name}" genera pérdida (margen ${(u.margin * 100).toFixed(1)}%).`);
    }
  });

  // 3. Combo completo
  const comboResult = calcularCombo(principal, upsellResults, principalResult.totalCosts);

  // 4. Comparativa
  const standaloneProfit = principalResult.profit;
  const minimumMarginDecimal = minimumMargin / 100;
  const comparativaResult = calcularComparativa(
    standaloneProfit,
    comboResult.profit,
    excellentThreshold,
    minimumMarginDecimal,
    comboResult.margin,
  );

  // Advertencia si margen del combo está por debajo del mínimo
  if (comboResult.margin > 0 && comboResult.margin < minimumMarginDecimal) {
    warnings.push(`El margen del combo (${(comboResult.margin * 100).toFixed(1)}%) está por debajo del objetivo mínimo (${minimumMargin}%).`);
  }
  if (comboResult.margin <= 0) {
    warnings.push('El combo no genera rentabilidad con la configuración actual.');
  }

  // 5. Recomendaciones
  const recommendations = calcularRecomendaciones(comboResult.totalCost, targetMargins);

  // 6. Precio mínimo y descuento máximo
  const minimumPrice = calcularPrecioMinimo(comboResult.totalCost);
  const maximumDiscountPercentage = calcularDescuentoMaximo(
    comboResult.totalCost,
    comboResult.originalPrice,
    minimumMargin,
  );

  // 7. Sensibilidad
  const sensitivity = calcularSensibilidad(
    { finalPrice: comboResult.finalPrice, totalCost: comboResult.totalCost },
    discountScenarios,
    { minimumMargin: minimumMarginDecimal },
  );

  return {
    principal: {
      ...principalResult,
      discountSimulation,
    },
    upsells: upsellResults,
    combo: comboResult,
    comparison: comparativaResult,
    recommendations,
    minimumPrice,
    maximumDiscountPercentage,
    sensitivity,
    warnings,
  };
}

module.exports = {
  calcular,
  calcularPrincipal,
  simularDescuentosPrincipal,
  calcularUpsell,
  calcularCombo,
  calcularComparativa,
  clasificarOferta,
  clasificarRentabilidad,
  RENTABILIDAD_META,
  calcularRecomendaciones,
  calcularPrecioMinimo,
  calcularDescuentoMaximo,
  calcularSensibilidad,
};
