/**
 * Utilidades de cálculo de precios.
 *
 * Centraliza la lógica de negocio de precios para que el controller,
 * las validaciones y los tests usen exactamente la misma función.
 */

/**
 * Calcula el precio efectivo de un producto, aplicando el descuento
 * solo si la fecha actual está dentro del rango [descuento_inicio, descuento_fin].
 *
 * @param {number} precio_base
 * @param {number} descuento_porcentaje  - Porcentaje (ej: 10 = 10%)
 * @param {Date|string|null} descuento_inicio
 * @param {Date|string|null} descuento_fin
 * @returns {number} Precio efectivo redondeado a 2 decimales.
 */
function calcularPrecioEfectivo(precio_base, descuento_porcentaje, descuento_inicio, descuento_fin) {
  const base = parseFloat(precio_base) || 0;
  const descuento = parseFloat(descuento_porcentaje) || 0;

  if (descuento <= 0) return Math.round(base * 100) / 100;

  const ahora = new Date();
  const inicio = descuento_inicio ? new Date(descuento_inicio) : null;
  const fin = descuento_fin ? new Date(descuento_fin) : null;

  const dentroDePeriodo =
    (!inicio || ahora >= inicio) &&
    (!fin || ahora <= fin);

  if (!dentroDePeriodo) return Math.round(base * 100) / 100;

  const efectivo = base * (1 - descuento / 100);
  return Math.round(efectivo * 100) / 100;
}

/**
 * Valida que el precio efectivo de un producto (y cada una de sus variantes)
 * no caiga por debajo del precio mínimo configurado.
 *
 * @param {object} params
 * @param {number}  params.precio_base
 * @param {number}  params.descuento_porcentaje
 * @param {Date}    params.descuento_inicio
 * @param {Date}    params.descuento_fin
 * @param {number}  params.precio_minimo
 * @param {Array}   params.variantes  - Array de { nombre, precio_diferencial }
 * @returns {{ valido: boolean, errores: string[] }}
 */
function validarPrecioMinimo({ precio_base, descuento_porcentaje, descuento_inicio, descuento_fin, precio_minimo, variantes = [] }) {
  const errores = [];
  const minimo = parseFloat(precio_minimo) || 0;

  if (minimo <= 0) return { valido: true, errores: [] };

  // Validar precio base del producto
  const efectivoBase = calcularPrecioEfectivo(precio_base, descuento_porcentaje, descuento_inicio, descuento_fin);
  if (efectivoBase < minimo) {
    errores.push(`El precio efectivo del producto ($${efectivoBase}) es menor al precio mínimo ($${minimo}).`);
  }

  // Validar cada variante
  for (const variante of variantes) {
    const precioConDif = parseFloat(precio_base) + (parseFloat(variante.precio_diferencial) || 0);
    const efectivoVariante = calcularPrecioEfectivo(precioConDif, descuento_porcentaje, descuento_inicio, descuento_fin);
    if (efectivoVariante < minimo) {
      errores.push(`La variante "${variante.nombre}" tiene precio efectivo ($${efectivoVariante}) menor al precio mínimo ($${minimo}).`);
    }
  }

  return { valido: errores.length === 0, errores };
}

module.exports = { calcularPrecioEfectivo, validarPrecioMinimo };
