'use strict';
const rutas = require('./rutasColaborador.json').map(r => ({ ...r,
  patron: new RegExp('^' + r.path.split('/').map(s => s.startsWith(':') ? (s === ':fontId' ? '[^/]+' : s === ':id' && r.path.startsWith('/api/mis-landings/') ? '(?:[0-9]+|todas)' : '[0-9]+') : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/') + '$'),
}));
function permiteModulo(permisos, modulo, escribir = false) {
  return permisos?.[modulo] === 'gestionar' || (!escribir && permisos?.[modulo] === 'ver');
}
function permiteRutaModulo(req) {
  if (!req.usuario.tiendaId) return false;
  const path = req.originalUrl.split('?')[0].replace(/\/$/, '');
  return rutas.some(r => r.method === req.method && r.patron.test(path) &&
    r.modulos.some(m => permiteModulo(req.usuario.accesos, m, r.nivel === 'gestionar')));
}
// Legacy permission middleware still runs after the per-endpoint policy.
// A legacy "gestionar" gate on a whole router does not grant write access:
// the request already passed the explicit read/write policy above.
function permisosLegacy(p) {
  const permisos = new Set();
  const alguno = (...keys) => keys.some(k => permiteModulo(p,k));
  if (alguno('comercial','dashboard_operativo','productos','ecommerce','depositos','publicidad')) permisos.add('ver_productos');
  if (alguno('productos','ecommerce','depositos')) for (const k of ['ver_combos','configurar_combos','crear_combos','ver_analisis_sensibilidad']) permisos.add(k);
  if (permiteModulo(p,'productos',true)) for (const k of ['crear_productos','editar_productos','eliminar_productos','editar_combos','activar_combos','gestionar_precio_propio']) permisos.add(k);
  if (alguno('ecommerce','dashboard_general','productos')) permisos.add('gestionar_landing');
  if (alguno('negocio','ecommerce','depositos','productos')) permisos.add('gestionar_tienda');
  if (alguno('negocio')) permisos.add('configurar_combos');
  if (alguno('publicidad')) permisos.add('gestionar_meta_ads');
  if (alguno('finanzas')) permisos.add('ver_costos_gastos');
  if (permiteModulo(p,'finanzas',true)) permisos.add('gestionar_costos_gastos');
  return [...permisos];
}
module.exports = { permiteRutaModulo, permisosLegacy, permiteModulo };
