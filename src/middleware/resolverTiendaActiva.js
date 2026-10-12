'use strict';

/**
 * Fallback para accessTokens emitidos antes de que existiera el claim
 * `tiendaId` (login/refresh ya lo setean siempre, pero un token de 15
 * minutos todavía en vuelo durante el despliegue no lo tiene). Si falta y
 * la cuenta tiene exactamente una tienda, se la resuelve al vuelo para esta
 * request — sin reemitir la cookie, el próximo /refresh ya lo hace bien.
 * Con 0 o ≥2 tiendas se deja en null: los endpoints de /api/mi-tienda
 * responden 409 y el frontend manda a /seleccionar-tienda.
 */
const { Tienda } = require('../models');

async function resolverTiendaActiva(req, res, next) {
  if (req.usuario.tiendaId) return next();
  try {
    const tiendas = await Tienda.findAll({ where: { usuario_id: req.usuario.id }, attributes: ['id'] });
    if (tiendas.length === 1) req.usuario.tiendaId = tiendas[0].id;
  } catch (err) {
    console.error('[resolverTiendaActiva]', err.message);
  }
  next();
}

/**
 * Para los routers que muestran datos POR TIENDA (pedidos, reportes,
 * rendición). Sus filtros agregan `tienda_id` solo cuando la sesión trae
 * tienda activa; con una cuenta de 2+ tiendas recién logueada (el claim queda
 * en null hasta que elige) eso devolvía los pedidos de TODAS sus tiendas
 * mezclados. Que el frontend mande a /seleccionar-tienda no alcanza: el
 * aislamiento tiene que valer aunque se le pegue a la API directo.
 *
 * - Administrador: pasa siempre, ve todo a propósito.
 * - 1 tienda: se resuelve al vuelo, igual que resolverTiendaActiva.
 * - 0 tiendas: pasa, no hay nada que mezclar.
 * - 2+ sin elegir: 409 con el mismo código que usa /api/mi-tienda.
 *
 * Si no se puede consultar la base se corta con error: acá fallar abierto
 * sería justamente mezclar tiendas.
 */
async function exigirTiendaActiva(req, res, next) {
  if (req.usuario.rol === 'administrador' || req.usuario.tiendaId) return next();
  let tiendas;
  try {
    tiendas = await Tienda.findAll({ where: { usuario_id: req.usuario.id }, attributes: ['id'] });
  } catch (err) {
    return next(err);
  }
  if (tiendas.length === 1) req.usuario.tiendaId = tiendas[0].id;
  if (tiendas.length <= 1) return next();
  return res.status(409).json({
    message: 'Elegí con qué tienda querés trabajar antes de continuar.',
    codigo: 'TIENDA_NO_SELECCIONADA',
  });
}

module.exports = { resolverTiendaActiva, exigirTiendaActiva };
