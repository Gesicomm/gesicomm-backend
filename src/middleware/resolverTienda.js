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

async function resolverTienda(req, res, next) {
  try {
    const hostname = (req.hostname || '').toLowerCase();

    if (esAppPrincipal(hostname)) {
      req.tienda = null;
      return next();
    }

    let tienda = null;
    // Se incluye Usuario (solo id/activo) porque obtenerPublica() necesita
    // saber si el dueño de la tienda sigue activo, sin otra consulta.
    const includeUsuario = [{ model: Usuario, attributes: ['id', 'activo'] }];

    if (hostname.endsWith(`.${BASE_DOMAIN}`)) {
      const sub = hostname.slice(0, -(`.${BASE_DOMAIN}`.length));
      tienda = await Tienda.findOne({ where: { subdominio: sub, activo: true }, include: includeUsuario });
    } else {
      tienda = await Tienda.findOne({
        where: { dominio_propio: hostname, dominio_propio_verificado: true, activo: true },
        include: includeUsuario,
      });
    }

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

module.exports = { resolverTienda, esAppPrincipal, BASE_DOMAIN, APP_HOSTNAME };
