'use strict';

/**
 * Resuelve la Tienda a partir del hostname de la request — la primera
 * pieza de infraestructura del proyecto que enruta por dominio en vez de
 * por path. Se monta SOLO en los routers de landings públicas
 * (routes/landingPublica.js, routes/landingHtml.js), nunca en toda la app.
 *
 * BASE_DOMAIN (env, default 'gesicomm.com') y APP_HOSTNAME (env, default
 * `app.${BASE_DOMAIN}`) definen cuáles hostnames son "la app principal"
 * (dashboard/vitrina/login) y no una tienda. 'localhost' siempre cuenta
 * como app principal, para no romper el desarrollo local.
 *
 * Casos:
 *   gesicomm.com / app.gesicomm.com / localhost  → app principal, next() sin req.tienda
 *   <sub>.gesicomm.com                            → busca Tienda por subdominio
 *   cualquier otro hostname                       → busca Tienda por dominio_propio verificado
 *   no encuentra tienda                           → 404
 */

const { Tienda, Usuario } = require('../models');

const BASE_DOMAIN = process.env.BASE_DOMAIN || 'gesicomm.com';
const APP_HOSTNAME = process.env.APP_HOSTNAME || `app.${BASE_DOMAIN}`;

function esAppPrincipal(hostname) {
  return hostname === 'localhost'
    || hostname === BASE_DOMAIN
    || hostname === `www.${BASE_DOMAIN}`
    || hostname === APP_HOSTNAME;
}

/**
 * La consulta sola, sin middleware alrededor. La comparten las dos
 * versiones de abajo para que la lógica de resolución exista una sola vez.
 *
 * @param {string} hostname
 * @returns {Promise<object|null>} null = app principal o no hay tienda
 */
async function buscarTiendaPorHostname(hostname) {
  const limpio = (hostname || '').toLowerCase();
  if (esAppPrincipal(limpio)) return null;

  // Se incluye Usuario (solo id/activo) porque obtenerPublica() necesita
  // saber si el dueño de la tienda sigue activo, sin otra consulta.
  const includeUsuario = [{ model: Usuario, attributes: ['id', 'activo'] }];

  if (limpio.endsWith(`.${BASE_DOMAIN}`)) {
    const sub = limpio.slice(0, -(`.${BASE_DOMAIN}`.length));
    return Tienda.findOne({ where: { subdominio: sub, activo: true }, include: includeUsuario });
  }

  return Tienda.findOne({
    where: { dominio_propio: limpio, dominio_propio_verificado: true, activo: true },
    include: includeUsuario,
  });
}

async function resolverTienda(req, res, next) {
  try {
    const hostname = (req.hostname || '').toLowerCase();

    if (esAppPrincipal(hostname)) {
      req.tienda = null;
      return next();
    }

    const tienda = await buscarTiendaPorHostname(hostname);
    if (!tienda) {
      return res.status(404).json({ message: 'No se encontró ninguna tienda en este dominio.' });
    }

    req.tienda = tienda;
    return next();
  } catch (err) {
    console.error('[resolverTienda]', err.message);
    return res.status(500).json({ message: 'Error al resolver la tienda.' });
  }
}

/**
 * Igual que resolverTienda, pero si el hostname no es de ninguna tienda
 * deja `req.tienda = null` y sigue, en vez de responder 404.
 *
 * Existe porque *.gesicomm.com dejó de ser exclusivo de las tiendas:
 * ahora también viven ahí los subdominios del Page Builder
 * (calcula.gesicomm.com). El handler necesita poder preguntar "¿no es una
 * tienda? probemos con una página del builder" antes de rendirse, y con
 * el middleware original nunca llegaba a ejecutarse.
 */
async function resolverTiendaOpcional(req, res, next) {
  try {
    req.tienda = await buscarTiendaPorHostname(req.hostname);
  } catch (err) {
    console.error('[resolverTiendaOpcional]', err.message);
    req.tienda = null;
  }
  return next();
}

module.exports = {
  resolverTienda,
  resolverTiendaOpcional,
  buscarTiendaPorHostname,
  esAppPrincipal,
  BASE_DOMAIN,
  APP_HOSTNAME,
};
