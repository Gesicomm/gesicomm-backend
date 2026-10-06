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

module.exports = { resolverTiendaActiva };
