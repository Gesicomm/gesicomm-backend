'use strict';
const ECOMMERCE = /^\/api\/(?:productos|categorias|marcas|combos|ofertas|couriers|depositos|fulfillment|envios|inventario|solicitudes-abastecimiento|importada-china|seguimiento|metodos-pago|liquidaciones|vitrina|mis-landings|mis-landings-simples|pages|mcp|landing-templates|mi-tienda|tiendas|reportes|clientes|meta-reportes|costos-gastos|categorias-costos-gastos|canales-venta|cupones|proveedores|page-builder|meta)(?:\/|$)/;
function rutaDeSolicitud(req) {
  const path = (req.originalUrl || '').split('?')[0];
  // La membresía se valida antes; listar tiendas permite elegir el propietario.
  if (/^\/api\/tiendas\/mias\/?$/.test(path) && req.method === 'GET' && req.usuario?.rol === 'colaborador') return null;
  // El servicio SSO valida identidad y vigencia, y revoca también el perfil remoto.
  if (/^\/api\/auth\/marca-personal\/(session|status)$/.test(path)) return null;
  if (/^\/api\/auth\/marca-personal(?:\/|$)/.test(path)) return 'personal';
  if (ECOMMERCE.test(path) || /^\/api\/integraciones\/(?:productos|speedbox|raha)(?:\/|$)/.test(path)) return 'fisico';
  return null;
}
async function accesoDeActor(actor) {
  if (actor.rol === 'administrador') return { fisico: true, personal: true };
  if (actor.rol === 'solo_pedidos') return { fisico: true, personal: false };
  if (actor.rol === 'colaborador' && actor.propietarioAdministrador) return { fisico: true, personal: false };
  const owner = actor.rol === 'colaborador' ? actor.propietarioId : actor.id;
  if (!owner) return { fisico: false, personal: false };
  const subscription = await require('../services/suscripcion.service').suscripcionActivaDeUsuario(owner);
  const rutas = require('../utils/rutasPlan').rutasDeSuscripcion(subscription);
  return actor.rol === 'colaborador' ? { fisico: rutas.fisico, personal: false } : rutas;
}
async function verificarAccesoSolicitud(req, res, next) {
  const ruta = rutaDeSolicitud(req);
  if (!ruta || req.usuario?.rol === 'administrador' || req.rutaNegocioVerificada === ruta) return next();
  try {
    const rutas = await accesoDeActor(req.usuario);
    if (!rutas[ruta]) return res.status(403).json({
      codigo: 'RUTA_NO_INCLUIDA', ruta, message: 'Tu plan no tiene acceso vigente a esta sección. Revisá tu suscripción.',
    });
    req.rutaNegocioVerificada = ruta;
    return next();
  } catch (error) {
    return res.status(503).json({ message: 'No pudimos verificar el acceso de tu plan. Reintentá.' });
  }
}
module.exports = { rutaDeSolicitud, accesoDeActor, verificarAccesoSolicitud };
