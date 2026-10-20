'use strict';

const BLOQUES = ['anuncios', 'encabezado_tienda', 'navegacion', 'hero', 'incluye', 'valor', 'beneficio_principal', 'detalle_productos', 'prueba_social', 'confianza', 'faq', 'pie', 'compra_movil'];

// Solo datos de presentación: límites de profundidad, listas y textos.
// Precios, componentes vendibles y cantidades del pedido siguen en el catálogo.
function limpiarDato(valor, profundidad = 0) {
  if (profundidad > 4) return undefined;
  if (typeof valor === 'string') return valor.slice(0, 2000);
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'number') return Number.isFinite(valor) ? Math.max(0, Math.min(120, valor)) : undefined;
  if (Array.isArray(valor)) return valor.slice(0, 10).map(v => limpiarDato(v, profundidad + 1)).filter(v => v !== undefined);
  if (!valor || typeof valor !== 'object') return undefined;
  return Object.fromEntries(Object.entries(valor)
    .filter(([k]) => /^[a-z][a-z_]{0,49}$/.test(k) && !['constructor', 'prototype'].includes(k))
    .slice(0, 40).map(([k, v]) => [k, k === 'id' && Number.isSafeInteger(v) && v > 0 ? v : limpiarDato(v, profundidad + 1)]).filter(([, v]) => v !== undefined));
}

module.exports = function limpiarFichaCombo(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const salida = Object.fromEntries(BLOQUES.filter(k => valor[k] && typeof valor[k] === 'object' && !Array.isArray(valor[k]))
    .map(k => [k, limpiarDato(valor[k])]));
  if (Array.isArray(valor._orden)) salida._orden = [...new Set(valor._orden.filter(k => BLOQUES.includes(k)))];
  if (Array.isArray(valor._orden_hero)) salida._orden_hero = [...new Set(valor._orden_hero.filter(k => ['titulo', 'calificacion', 'descripcion', 'precio', 'caracteristicas', 'compra', 'notas'].includes(k)))];
  if (valor._visibilidad && typeof valor._visibilidad === 'object') salida._visibilidad = Object.fromEntries(
    Object.entries(valor._visibilidad).filter(([k, v]) => BLOQUES.includes(k) && typeof v === 'boolean'));
  return salida;
};
