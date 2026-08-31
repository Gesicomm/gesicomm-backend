'use strict';

/**
 * Resuelve el hostname de la request contra el registro de hostnames del
 * Page Builder (builder_domains).
 *
 * Es el hermano de middleware/resolverTienda.js, pero para el otro
 * inquilino del mismo espacio de hostnames: bajo *.gesicomm.com conviven
 * los subdominios de tienda (somnix.gesicomm.com) y los de páginas del
 * builder (calcula.gesicomm.com), más los dominios propios de cada uno.
 *
 * A diferencia de resolverTienda, este NUNCA responde 404 por su cuenta:
 * deja `req.builderHost = null` y sigue. El que decide qué hacer con eso
 * es el handler, porque en varias rutas "no es del builder" significa
 * "probá con una tienda" y no "error".
 *
 * En localhost no resuelve nada (no hay subdominios que resolver en
 * desarrollo): ahí se usan las rutas de fallback /p/<slug> y
 * /f/<funnel>/<pagina>.
 */

const BuilderPublicPageService = require('../services/builderPublicPage.service');
const { esAppPrincipal } = require('./resolverTienda');

async function resolverHostBuilder(req, res, next) {
  try {
    const hostname = (req.hostname || '').toLowerCase();

    if (esAppPrincipal(hostname)) {
      req.builderHost = null;
      return next();
    }

    req.builderHost = await BuilderPublicPageService.resolverHostname(hostname);
    return next();
  } catch (err) {
    console.error('[resolverHostBuilder]', err.message);
    req.builderHost = null;
    return next();
  }
}

module.exports = { resolverHostBuilder };
