'use strict';
const RUTAS = new Set(['fisico', 'personal', 'ambas']);
function accesoDelPlan(plan) {
  if (['elegir', ...RUTAS].includes(plan?.acceso_rutas)) return plan.acceso_rutas;
  if (String(plan?.codigo || '').startsWith('una-ruta-')) return 'elegir';
  // Compatibilidad de planes anteriores al control por ruta.
  return 'ambas';
}
function resolverRuta(plan, elegida) {
  const acceso = accesoDelPlan(plan);
  const error = message => Object.assign(new Error(message), { status: 400 });
  if (elegida != null && !RUTAS.has(elegida)) throw error('Ruta de negocio inválida.');
  if (acceso === 'elegir') {
    if (!['fisico', 'personal'].includes(elegida)) throw error('Elegí e-commerce o marca personal para este plan de una ruta.');
    return elegida;
  }
  if (acceso !== 'ambas' && elegida && elegida !== acceso) throw error('La ruta elegida no está incluida en este plan.');
  return acceso;
}
function rutasDeSuscripcion(suscripcion) {
  if (!suscripcion) return { fisico: false, personal: false };
  const fin = suscripcion.periodo_fin == null ? null : new Date(suscripcion.periodo_fin).getTime();
  if (suscripcion.estado !== 'activa' || (fin !== null && (!Number.isFinite(fin) || fin <= Date.now()))) return { fisico: false, personal: false };
  if (suscripcion.acceso_permanente === true) return {fisico:true,personal:true};
  const politica = accesoDelPlan(suscripcion.Plan);
  const guardada = suscripcion.ruta_acceso;
  // Una política restrictiva actual nunca se amplía por datos viejos de la suscripción.
  const ruta = politica === 'elegir' ? (['fisico', 'personal'].includes(guardada) ? guardada : null)
    : politica === 'ambas' ? (RUTAS.has(guardada) ? guardada : 'ambas') : politica;
  return { fisico: ruta === 'fisico' || ruta === 'ambas', personal: ruta === 'personal' || ruta === 'ambas' };
}
module.exports = { accesoDelPlan, resolverRuta, rutasDeSuscripcion };
