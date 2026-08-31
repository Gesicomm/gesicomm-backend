'use strict';

/**
 * Slugs que ninguna landing, funnel o página del Page Builder puede usar,
 * porque el path ya está tomado por otra cosa en el hostname de una tienda
 * (https://<tienda>.gesicomm.com/...).
 *
 * De dónde sale cada grupo:
 *
 *  - 'p' y 'f': los prefijos del Page Builder (/p/<pagina>, /f/<funnel>/<pagina>).
 *  - 'l': ruta pública histórica de landings (/l y /l/:slug, ver routes/landingHtml.js).
 *  - 'api', 'uploads', 'assets', '_frontend-shell': las sirve Nginx o Express
 *    antes de que nada de esto entre en juego (ver deploy/nginx/tiendas.gesicomm.com).
 *  - El resto: rutas propias del SPA que comparten forma con un slug de un
 *    solo segmento (App.jsx: /catalogo, /contacto, las páginas legales...).
 *    Nginx les da match exacto justamente para que ganen sobre la regex de slug.
 *
 * Si se agrega una ruta pública nueva de un solo segmento en App.jsx o en
 * el vhost de nginx, hay que sumarla acá.
 */

const SLUGS_RESERVADOS = new Set([
  // Prefijos del Page Builder
  'p', 'f',
  // Landings
  'l',
  // Infraestructura
  'api', 'uploads', 'assets', '_frontend-shell', 'favicon.ico', 'vite.svg',
  // Rutas del SPA
  'catalogo', 'contacto', 'login', 'dashboard',
  'politica-privacidad', 'politica-reembolso', 'terminos-servicio',
  'politica-envio', 'aviso-legal',
]);

/** @param {string} slug @returns {boolean} */
function esSlugReservado(slug) {
  return SLUGS_RESERVADOS.has(String(slug || '').toLowerCase());
}

module.exports = { SLUGS_RESERVADOS, esSlugReservado };
